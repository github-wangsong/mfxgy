# 第三部分：后端核心业务与高级功能

---

## 1. 订单创建完整实现（OrderServiceImpl）

```java
package com.dingcan.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.dingcan.dto.*;
import com.dingcan.entity.*;
import com.dingcan.mapper.*;
import com.dingcan.service.*;
import com.dingcan.util.OrderNoUtil;
import com.dingcan.websocket.TableCartWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class OrderServiceImpl extends ServiceImpl<OrderMapper, Order> implements OrderService {

    private final OrderItemMapper           orderItemMapper;
    private final TableMapper               tableMapper;
    private final DishService               dishService;
    private final TableCartWebSocketHandler tableCartWebSocketHandler;

    private static final String[] STATUS_TEXTS = {"待确认","制作中","已上菜","已结账","已取消"};

    // 查询桌台活跃订单
    @Override
    public OrderDetailVO getActiveOrderByTable(Integer tableId) {
        List<OrderDetailVO> list = baseMapper.findActiveOrdersByTable(tableId);
        if (list == null || list.isEmpty()) return null;
        OrderDetailVO vo = list.get(0);
        vo.setItems(orderItemMapper.findByOrderId(vo.getId()));
        vo.setStatusText(getStatusText(vo.getStatus()));
        return vo;
    }

    // 创建订单
    @Override
    @Transactional(rollbackFor = Exception.class)
    public String createOrder(OrderCreateDTO dto) {
        // 1. 校验桌台
        RestaurantTable table = tableMapper.selectById(dto.getTableId());
        if (table == null) throw new RuntimeException("桌台不存在");

        // 2. 防重复：同桌已有活跃订单
        List<OrderDetailVO> active = baseMapper.findActiveOrdersByTable(dto.getTableId());
        if (active != null && !active.isEmpty())
            throw new RuntimeException("该桌台已有进行中的订单：" + active.get(0).getOrderNo());

        // 3. 从数据库验价并构建订单详情
        List<OrderItem> items  = new ArrayList<>();
        BigDecimal totalAmount = BigDecimal.ZERO;

        for (OrderCreateDTO.OrderItemDTO itemDto : dto.getItems()) {
            Dish dish = dishService.getById(itemDto.getDishId());
            if (dish == null || dish.getIsAvailable() != 1)
                throw new RuntimeException("菜品不存在或已下架，dishId=" + itemDto.getDishId());

            BigDecimal subtotal = dish.getPrice().multiply(BigDecimal.valueOf(itemDto.getQuantity()));
            totalAmount = totalAmount.add(subtotal);

            OrderItem item = new OrderItem();
            item.setDishId(dish.getId());
            item.setDishName(dish.getName());   // 冗余存储：防止菜品改名影响历史订单
            item.setPrice(dish.getPrice());      // 冗余存储：防止价格修改影响历史订单
            item.setQuantity(itemDto.getQuantity());
            item.setSubtotal(subtotal);
            items.add(item);
        }

        // 4. 生成订单编号并保存（事务：任何异常都全部回滚）
        String orderNo = OrderNoUtil.generate();
        log.info("创建订单，桌台：{}，编号：{}", table.getTableNumber(), orderNo);

        Order order = new Order();
        order.setOrderNo(orderNo);
        order.setTableId(dto.getTableId());
        order.setUserId(dto.getUserId());       // 可为 null（匿名点餐）
        order.setTotalAmount(totalAmount);
        order.setStatus(0);                     // 初始：待确认
        order.setRemark(dto.getRemark());
        save(order);                            // INSERT 后 order.getId() 自动填入

        for (OrderItem item : items) {
            item.setOrderId(order.getId());
            orderItemMapper.insert(item);
        }

        tableMapper.updateStatus(dto.getTableId(), 1);  // 桌台→用餐中

        // 5. 通知同桌所有设备清空购物车
        tableCartWebSocketHandler.clearAndBroadcastEmpty(dto.getTableId());

        return orderNo;
    }

    // 加菜（继续点餐场景）
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void addItemsToOrder(String orderNo, List<OrderCreateDTO.OrderItemDTO> newItems) {
        OrderDetailVO vo = baseMapper.findDetailByOrderNo(orderNo);
        if (vo == null) throw new RuntimeException("订单不存在");
        if (vo.getStatus() >= 3) throw new RuntimeException("订单已结束，无法加菜");

        BigDecimal addedAmount = BigDecimal.ZERO;
        for (OrderCreateDTO.OrderItemDTO itemDto : newItems) {
            Dish dish = dishService.getById(itemDto.getDishId());
            if (dish == null || dish.getIsAvailable() != 1)
                throw new RuntimeException("菜品不存在或已下架");

            BigDecimal subtotal = dish.getPrice().multiply(BigDecimal.valueOf(itemDto.getQuantity()));
            addedAmount = addedAmount.add(subtotal);

            OrderItem item = new OrderItem();
            item.setOrderId(vo.getId());
            item.setDishId(dish.getId());
            item.setDishName(dish.getName());
            item.setPrice(dish.getPrice());
            item.setQuantity(itemDto.getQuantity());
            item.setSubtotal(subtotal);
            orderItemMapper.insert(item);
        }

        // 更新订单总金额（原金额 + 加菜金额）
        Order order = getById(vo.getId());
        order.setTotalAmount(order.getTotalAmount().add(addedAmount));
        updateById(order);
    }

    // 查询订单详情
    @Override
    public OrderDetailVO getOrderDetail(String orderNo) {
        OrderDetailVO vo = baseMapper.findDetailByOrderNo(orderNo);
        if (vo == null) throw new RuntimeException("订单不存在，orderNo=" + orderNo);
        vo.setItems(orderItemMapper.findByOrderId(vo.getId()));
        vo.setStatusText(getStatusText(vo.getStatus()));
        return vo;
    }

    // 更新订单状态（管理端操作）
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateOrderStatus(Integer orderId, Integer status) {
        Order order = getById(orderId);
        if (order == null) throw new RuntimeException("订单不存在");

        order.setStatus(status);
        updateById(order);

        if (status == 3) {  // 结账：桌台→空闲
            tableMapper.updateStatus(order.getTableId(), 0);
            tableCartWebSocketHandler.clearAndBroadcastEmpty(order.getTableId());
            log.info("订单 {} 已结账，桌台 {} 改为空闲", order.getOrderNo(), order.getTableId());
        }
        if (status == 4) {  // 取消：清空购物车
            tableCartWebSocketHandler.clearAndBroadcastEmpty(order.getTableId());
        }
    }

    private String getStatusText(Integer status) {
        if (status == null || status < 0 || status >= STATUS_TEXTS.length) return "未知";
        return STATUS_TEXTS[status];
    }
}
```

---

## 2. WebSocket 处理器（购物车同步）

```java
// TableCartWebSocketHandler.java 完整代码
// 连接地址：ws://localhost:8888/ws/table-cart?tableId=1

@Slf4j
@Component
public class TableCartWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();

    // tableId → 连接此桌的所有设备（线程安全）
    private final Map<Integer, Set<WebSocketSession>> tableSessions   = new ConcurrentHashMap<>();
    // tableId → 服务端权威购物车状态
    private final Map<Integer, List<Map<String, Object>>> tableCartState = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Integer tableId = parseTableId(session);
        if (tableId == null) { closeSilently(session, CloseStatus.BAD_DATA); return; }

        session.getAttributes().put("tableId", tableId);
        tableSessions.computeIfAbsent(tableId, k -> ConcurrentHashMap.newKeySet()).add(session);

        // 立刻给新设备推送当前购物车（晚加入者自动同步）
        List<Map<String, Object>> current = tableCartState.getOrDefault(tableId, Collections.emptyList());
        sendSync(session, current);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Integer tableId = (Integer) session.getAttributes().get("tableId");
        if (tableId == null) return;
        try {
            Map<String, Object> payload = objectMapper.readValue(
                message.getPayload(), new TypeReference<Map<String, Object>>() {});
            if (!"cart_update".equals(payload.get("type"))) return;

            List<Map<String, Object>> items = (List<Map<String, Object>>) payload.get("items");
            if (items == null) items = Collections.emptyList();

            tableCartState.put(tableId, items);         // 更新权威状态
            broadcastToOthers(session, tableId, items); // 广播给其他设备（不回显给发送者）
        } catch (Exception e) {
            log.warn("[TableCart WS] 处理消息失败 tableId={}", tableId);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        removeSession(session);
    }

    // 订单提交/结账/取消时：清空购物车并广播
    public void clearAndBroadcastEmpty(Integer tableId) {
        tableCartState.remove(tableId);
        Set<WebSocketSession> sessions = tableSessions.get(tableId);
        if (sessions == null || sessions.isEmpty()) return;
        sessions.removeIf(s -> !s.isOpen());
        TextMessage emptyMsg = buildSyncMessage(Collections.emptyList());
        for (WebSocketSession s : sessions) {
            try { if (s.isOpen()) s.sendMessage(emptyMsg); } catch (IOException ignored) {}
        }
        log.info("[TableCart WS] 桌台 {} 购物车已清空并通知所有设备", tableId);
    }

    private void sendSync(WebSocketSession session, List<Map<String, Object>> items) {
        try { session.sendMessage(buildSyncMessage(items)); } catch (IOException ignored) {}
    }

    private void broadcastToOthers(WebSocketSession sender, Integer tableId, List<Map<String, Object>> items) {
        Set<WebSocketSession> sessions = tableSessions.get(tableId);
        if (sessions == null) return;
        sessions.removeIf(s -> !s.isOpen());
        TextMessage msg = buildSyncMessage(items);
        for (WebSocketSession s : sessions) {
            if (!s.getId().equals(sender.getId()) && s.isOpen()) {
                try { s.sendMessage(msg); } catch (IOException ignored) {}
            }
        }
    }

    private TextMessage buildSyncMessage(List<Map<String, Object>> items) {
        try {
            Map<String, Object> msg = new HashMap<>();
            msg.put("type", "cart_sync");
            msg.put("items", items);
            return new TextMessage(objectMapper.writeValueAsString(msg));
        } catch (Exception e) {
            return new TextMessage("{\"type\":\"cart_sync\",\"items\":[]}");
        }
    }

    private void removeSession(WebSocketSession session) {
        Object tableIdObj = session.getAttributes().get("tableId");
        if (tableIdObj == null) return;
        Integer tableId = (Integer) tableIdObj;
        Set<WebSocketSession> sessions = tableSessions.get(tableId);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) tableSessions.remove(tableId);
        }
    }

    private Integer parseTableId(WebSocketSession session) {
        if (session.getUri() == null) return null;
        String val = UriComponentsBuilder.fromUri(session.getUri())
            .build().getQueryParams().getFirst("tableId");
        if (val == null) return null;
        try { return Integer.parseInt(val); } catch (NumberFormatException e) { return null; }
    }

    private void closeSilently(WebSocketSession session, CloseStatus status) {
        try { session.close(status); } catch (IOException ignored) {}
    }
}
```

---

## 3. 管理端新增订单 API

```typescript
// admin/server/api/orders/admin.post.ts

import { query, transaction } from '~/server/utils/db'
import { requireAuth } from '~/server/utils/auth'

function generateOrderNo(): string {
  const ts   = Date.now().toString()
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `ORD${ts}${rand}`
}

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const { tableId, items, remark } = await readBody(event)

  if (!tableId)     throw createError({ statusCode: 400, statusMessage: '桌台ID不能为空' })
  if (!items?.length) throw createError({ statusCode: 400, statusMessage: '菜品列表不能为空' })

  const tables = await query('SELECT * FROM restaurant_table WHERE id = ?', [tableId])
  if (!tables.length) throw createError({ statusCode: 404, statusMessage: '桌台不存在' })

  // 服务端验价
  let totalAmount = 0
  const orderItems: any[] = []

  for (const item of items) {
    const dishes = await query('SELECT * FROM dish WHERE id = ? AND is_available = 1', [item.dishId])
    if (!dishes.length) throw createError({ statusCode: 400, statusMessage: `菜品不存在：${item.dishId}` })
    const dish     = dishes[0] as any
    const qty      = parseInt(item.quantity) || 1
    const subtotal = parseFloat(dish.price) * qty
    totalAmount   += subtotal
    orderItems.push({ dishId: dish.id, dishName: dish.name, price: dish.price, quantity: qty, subtotal: subtotal.toFixed(2) })
  }

  const orderNo = generateOrderNo()

  await transaction(async (conn) => {
    const [result]: any = await conn.execute(
      'INSERT INTO `order` (order_no, table_id, total_amount, status, remark) VALUES (?, ?, ?, 0, ?)',
      [orderNo, tableId, totalAmount.toFixed(2), remark || null]
    )
    const orderId = result.insertId

    for (const item of orderItems) {
      await conn.execute(
        'INSERT INTO order_item (order_id, dish_id, dish_name, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, item.dishId, item.dishName, item.price, item.quantity, item.subtotal]
      )
    }

    await conn.execute(
      'UPDATE restaurant_table SET status = 1, updated_at = NOW() WHERE id = ?',
      [tableId]
    )
  })

  return { orderNo, message: '订单创建成功' }
})
```

---

## 4. 趋势数据 API（含时区陷阱解析）

```typescript
// admin/server/api/dashboard/trend.get.ts 关键代码

// ⚠️ 时区陷阱说明：
// new Date().toISOString() 返回 UTC 时间字符串
// 在 UTC+8 服务器上，凌晨 0:30 本地时间 = UTC 昨天 16:30
// 如果用 toISOString().split('T')[0] 取日期，在 UTC+8 的凌晨前会拿到"昨天"！

// ✅ 正确做法：用本地时间分量构造日期字符串
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)  // 本地时间构造，无 UTC 偏移
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
}

// 使用方式（dateTo = "2026-05-14"时）
// addDays("2026-05-14", 1) → "2026-05-15"
// 查询条件：created_at >= '2026-05-14 00:00:00' AND created_at < '2026-05-15 00:00:00'
// ✅ 包含完整的 2026-05-14 全天数据

// ❌ 错误做法（曾导致"今日数据查不出来"的 Bug）：
// const nextDay = new Date(dateTo)
// nextDay.setDate(nextDay.getDate() + 1)
// return nextDay.toISOString().split('T')[0]
// 在 UTC+8 上：new Date('2026-05-14') = 本地当天 00:00 = UTC 5月13日 16:00
// toISOString() = '2026-05-14T16:00:00Z' → split('T')[0] = '2026-05-14'（没加一天！）
```

---

## 5. 常见坑汇总

### 坑 1：order 是 MySQL 保留字

```java
// ❌ 会报语法错误
@TableName("order")

// ✅ 用反引号
@TableName("`order`")

// Mapper 中的 SQL 也要加反引号
@Select("SELECT * FROM `order` WHERE id = #{id}")
```

### 坑 2：Spring Boot 字段名与数据库列名对应

```
application.yml 配置了 map-underscore-to-camel-case: true
所以：
  数据库列 order_no  → Java 字段 orderNo
  数据库列 is_available → Java 字段 isAvailable
  数据库列 created_at → Java 字段 createdAt

Jackson 序列化时默认保持驼峰格式：
  Java orderNo → JSON "orderNo"
  Java createdAt → JSON "createdAt"（不是 created_at！）

前端需要注意：Spring Boot 返回的是 camelCase（驼峰）
const name = dish.imageUrl  // ✅ 正确
const name = dish.image_url // ❌ undefined（Spring Boot 不返回下划线格式）
```

### 坑 3：BigDecimal 运算

```java
// ❌ 用 double：精度丢失
double total = 0.1 + 0.2; // = 0.30000000000000004

// ✅ 用 BigDecimal
BigDecimal a = new BigDecimal("0.1");
BigDecimal b = new BigDecimal("0.2");
BigDecimal total = a.add(b); // = 0.3

// BigDecimal 不能用 +/-/*/ 运算符，必须用方法：
// add(b)       加法
// subtract(b)  减法
// multiply(b)  乘法
// divide(b)    除法（需指定精度和舍入模式）
```

### 坑 4：事务不生效的情况

```java
// @Transactional 在以下情况可能不生效：
// 1. 方法是 private（Spring AOP 无法代理私有方法）
// 2. 同类中调用（方法 A 调方法 B，B 的 @Transactional 不生效）
// 3. 异常被 catch 吃掉没有 rethrow

// ✅ 正确用法：
@Transactional(rollbackFor = Exception.class)
public void doSomething() {
    // rollbackFor = Exception.class：任何异常都回滚
    // 默认只回滚 RuntimeException 和 Error
    // 推荐加上 Exception.class 保证所有异常都回滚
}
```

### 坑 5：WebSocket SSR 问题

```typescript
// Nuxt 3 有服务端渲染（SSR），服务端没有浏览器环境
// 服务端没有 window 对象，没有 WebSocket

// ❌ 直接写会在服务端报错
const ws = new WebSocket('ws://...')

// ✅ 判断是否在浏览器环境
function connectWebSocket() {
  if (typeof window === 'undefined') return  // 服务端跳过
  ws = new WebSocket('ws://...')
}

// ✅ 或者只在 onMounted 中执行（onMounted 只在客户端执行）
onMounted(() => {
  connectWebSocket()  // 安全：此时一定是浏览器环境
})
```
