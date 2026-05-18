## 第一章：认识 SSM，我们为什么学它？
SSM 是三个框架的缩写：

Spring – 一个轻量级的 控制反转（IoC） 和 面向切面编程（AOP） 容器框架。简单说，它帮我们管理对象，让代码解耦。

Spring MVC – 基于 Spring 的 Web 层框架，负责接收请求、分发、返回响应。它实现了 MVC 设计模式。

MyBatis – 一个优秀的持久层框架，支持定制化 SQL、存储过程及高级映射。它让操作数据库变得很简单，不用写一大堆 JDBC 样板代码。

三者组合在一起，分工明确：

用户请求 → Spring MVC（Controller） → Spring（Service） → MyBatis（DAO/Mapper） → 数据库

学完这套教程，你将能独立开发标准的企业级后端项目。

## 第二章：开发环境准备（小白照着做）
我们需要以下工具：

JDK 1.8 及以上（推荐 JDK8）

Maven 3.6+（项目构建和依赖管理）

IDEA / Eclipse（开发工具，推荐 IntelliJ IDEA）

MySQL 5.7+（数据库）

Navicat / MySQL Workbench（可选，方便查看数据库）

项目结构预览（Maven Web 项目）：

```text
ssm-demo
├── src
│   ├── main
│   │   ├── java
│   │   │   └── com.yourcompany
│   │   │       ├── controller (Controller 层)
│   │   │       ├── service      (Service 接口及实现)
│   │   │       ├── dao           (Mapper 接口)
│   │   │       └── pojo          (实体类)
│   │   ├── resources
│   │   │   ├── spring-mvc.xml   (Spring MVC 配置)
│   │   │   ├── spring-dao.xml   (Spring 持久层配置)
│   │   │   ├── spring-service.xml (Spring 业务层配置)
│   │   │   ├── mybatis-config.xml (MyBatis 配置文件)
│   │   │   └── jdbc.properties   (数据库连接信息)
│   │   └── webapp
│   │       ├── WEB-INF
│   │       │   └── web.xml       (核心入口)
│   │       └── index.jsp
│   └── test
├── pom.xml
```
## 第三章：新建 Maven 工程并引入依赖
用 IDEA 新建一个 Maven 项目，选择 maven-archetype-webapp 骨架。
然后在 pom.xml 中添加以下依赖（我精简了，只放核心）：

```xml
<properties>
    <spring.version>5.2.8.RELEASE</spring.version>
    <mybatis.version>3.5.5</mybatis.version>
    <mybatis-spring.version>2.0.5</mybatis-spring.version>
    <mysql.version>8.0.21</mysql.version>
    <druid.version>1.1.22</druid.version>
    <jsp-api.version>2.2</jsp-api.version>
    <servlet-api.version>3.1.0</servlet-api.version>
</properties>

<dependencies>
    <!-- Spring 核心 -->
    <dependency>
        <groupId>org.springframework</groupId>
        <artifactId>spring-context</artifactId>
        <version>${spring.version}</version>
    </dependency>
    <dependency>
        <groupId>org.springframework</groupId>
        <artifactId>spring-webmvc</artifactId>
        <version>${spring.version}</version>
    </dependency>
    <dependency>
        <groupId>org.springframework</groupId>
        <artifactId>spring-jdbc</artifactId>
        <version>${spring.version}</version>
    </dependency>

    <!-- MyBatis 核心 -->
    <dependency>
        <groupId>org.mybatis</groupId>
        <artifactId>mybatis</artifactId>
        <version>${mybatis.version}</version>
    </dependency>
    <dependency>
        <groupId>org.mybatis</groupId>
        <artifactId>mybatis-spring</artifactId>
        <version>${mybatis-spring.version}</version>
    </dependency>

    <!-- 数据库连接池 -->
    <dependency>
        <groupId>com.alibaba</groupId>
        <artifactId>druid</artifactId>
        <version>${druid.version}</version>
    </dependency>
    <dependency>
        <groupId>mysql</groupId>
        <artifactId>mysql-connector-java</artifactId>
        <version>${mysql.version}</version>
    </dependency>

    <!-- JSP 相关 -->
    <dependency>
        <groupId>javax.servlet</groupId>
        <artifactId>javax.servlet-api</artifactId>
        <version>${servlet-api.version}</version>
        <scope>provided</scope>
    </dependency>
    <dependency>
        <groupId>javax.servlet.jsp</groupId>
        <artifactId>jsp-api</artifactId>
        <version>${jsp-api.version}</version>
        <scope>provided</scope>
    </dependency>

    <!-- 日志（方便查看SQL执行） -->
    <dependency>
        <groupId>ch.qos.logback</groupId>
        <artifactId>logback-classic</artifactId>
        <version>1.2.3</version>
    </dependency>
</dependencies>
```
小贴士：scope provided 表示打包时不带这些包，因为 Tomcat 自带了。

## 第四章：数据库设计与实体类
在 MySQL 中建一个库 ssm_demo，执行：

```sql
CREATE DATABASE ssm_demo DEFAULT CHARACTER SET utf8mb4;
USE ssm_demo;
CREATE TABLE `user` (
    `id` int NOT NULL AUTO_INCREMENT,
    `username` varchar(50) NOT NULL,
    `password` varchar(50) NOT NULL,
    `age` int,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
对应 Java 实体类（pojo 包下）：

```java
package com.yourcompany.pojo;

public class User {
    private Integer id;
    private String username;
    private String password;
    private Integer age;

    // 无参构造
    public User() {}
    // 有参构造 (方便测试)
    public User(Integer id, String username, String password, Integer age) {
        this.id = id;
        this.username = username;
        this.password = password;
        this.age = age;
    }

    // getter/setter （省略，请用IDE生成）
}
```
## 第五章：MyBatis 持久层配置（DAO 层）
### 5.1 数据库连接配置文件 jdbc.properties
```properties
jdbc.driver=com.mysql.cj.jdbc.Driver
jdbc.url=jdbc:mysql://localhost:3306/ssm_demo?useSSL=false&serverTimezone=UTC&characterEncoding=utf8
jdbc.username=root
jdbc.password=123456
```
### 5.2 MyBatis 主配置 mybatis-config.xml
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE configuration
        PUBLIC "-//mybatis.org//DTD Config 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-config.dtd">
<configuration>
    <!-- 设置驼峰命名自动映射 -->
    <settings>
        <setting name="mapUnderscoreToCamelCase" value="true"/>
    </settings>
    <!-- 实体类别名，简化mapper中的resultType -->
    <typeAliases>
        <package name="com.yourcompany.pojo"/>
    </typeAliases>
</configuration>
```
### 5.3 Spring 整合 MyBatis 配置：spring-dao.xml
这个文件专门负责数据源、SqlSessionFactory、Mapper 扫描等。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:context="http://www.springframework.org/schema/context"
       xsi:schemaLocation="
         http://www.springframework.org/schema/beans
         https://www.springframework.org/schema/beans/spring-beans.xsd
         http://www.springframework.org/schema/context
         https://www.springframework.org/schema/context/spring-context.xsd">

    <!-- 1. 引入外部属性文件 -->
    <context:property-placeholder location="classpath:jdbc.properties"/>

    <!-- 2. Druid 数据源 -->
    <bean id="dataSource" class="com.alibaba.druid.pool.DruidDataSource">
        <property name="driverClassName" value="${jdbc.driver}"/>
        <property name="url" value="${jdbc.url}"/>
        <property name="username" value="${jdbc.username}"/>
        <property name="password" value="${jdbc.password}"/>
    </bean>

    <!-- 3. SqlSessionFactoryBean (整合核心) -->
    <bean id="sqlSessionFactory" class="org.mybatis.spring.SqlSessionFactoryBean">
        <!-- 注入数据源 -->
        <property name="dataSource" ref="dataSource"/>
        <!-- 指定 MyBatis 全局配置文件 -->
        <property name="configLocation" value="classpath:mybatis-config.xml"/>
        <!-- 扫描 Mapper XML 文件 -->
        <property name="mapperLocations" value="classpath:mapper/*.xml"/>
    </bean>

    <!-- 4. 扫描 Mapper 接口包，生成代理对象注入Spring -->
    <bean class="org.mybatis.spring.mapper.MapperScannerConfigurer">
        <property name="sqlSessionFactoryBeanName" value="sqlSessionFactory"/>
        <property name="basePackage" value="com.yourcompany.dao"/>
    </bean>
</beans>
```
### 5.4 编写 Mapper 接口和对应的 XML
在 dao 包下新建 UserMapper 接口：

```java
package com.yourcompany.dao;

import com.yourcompany.pojo.User;
import java.util.List;

public interface UserMapper {
    // 查询所有用户
    List<User> queryAllUser();
    // 根据id查询
    User queryUserById(Integer id);
    // 新增用户
    int addUser(User user);
    // 更新用户
    int updateUser(User user);
    // 删除用户
    int deleteUser(Integer id);
}
```
在 resources 下创建 mapper 文件夹，新建 UserMapper.xml：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper
        PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.yourcompany.dao.UserMapper">

    <select id="queryAllUser" resultType="User">
        select * from user
    </select>

    <select id="queryUserById" parameterType="int" resultType="User">
        select * from user where id = #{id}
    </select>

    <insert id="addUser" parameterType="User">
        insert into user (username, password, age)
        values (#{username}, #{password}, #{age})
    </insert>

    <update id="updateUser" parameterType="User">
        update user
        set username=#{username}, password=#{password}, age=#{age}
        where id=#{id}
    </update>

    <delete id="deleteUser" parameterType="int">
        delete from user where id=#{id}
    </delete>
</mapper>
```
现在持久层就准备完毕了，MyBatis 会自动帮我们根据接口和 XML 生成实现类（代理），我们可以直接在 Service 里注入 UserMapper。

## 第六章：Spring 业务层配置（Service 层）
### 6.1 编写 Service 接口和实现
service 包：

```java
package com.yourcompany.service;

import com.yourcompany.pojo.User;
import java.util.List;

public interface UserService {
    List<User> findAll();
    User findById(Integer id);
    int add(User user);
    int modify(User user);
    int remove(Integer id);
}
```
service.impl 包：

```java
package com.yourcompany.service.impl;

import com.yourcompany.dao.UserMapper;
import com.yourcompany.pojo.User;
import com.yourcompany.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class UserServiceImpl implements UserService {

    @Autowired
    private UserMapper userMapper;

    @Override
    public List<User> findAll() {
        return userMapper.queryAllUser();
    }

    @Override
    public User findById(Integer id) {
        return userMapper.queryUserById(id);
    }

    @Override
    public int add(User user) {
        return userMapper.addUser(user);
    }

    @Override
    public int modify(User user) {
        return userMapper.updateUser(user);
    }

    @Override
    public int remove(Integer id) {
        return userMapper.deleteUser(id);
    }
}
```
### 6.2 业务层 Spring 配置：spring-service.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:context="http://www.springframework.org/schema/context"
       xmlns:tx="http://www.springframework.org/schema/tx"
       xsi:schemaLocation="
         http://www.springframework.org/schema/beans
         https://www.springframework.org/schema/beans/spring-beans.xsd
         http://www.springframework.org/schema/context
         https://www.springframework.org/schema/context/spring-context.xsd
         http://www.springframework.org/schema/tx
         https://www.springframework.org/schema/tx/spring-tx.xsd">

    <!-- 1. 扫描业务层组件 -->
    <context:component-scan base-package="com.yourcompany.service"/>

    <!-- 2. 事务管理器 -->
    <bean id="transactionManager" class="org.springframework.jdbc.datasource.DataSourceTransactionManager">
        <!-- 注意这里的 ref 和 spring-dao.xml 中的数据源 id 一致 -->
        <property name="dataSource" ref="dataSource"/>
    </bean>

    <!-- 3. 开启事务注解支持 -->
    <tx:annotation-driven transaction-manager="transactionManager"/>
</beans>
```
注意：这里的数据源 dataSource 是跨配置文件引用的，因为最终我们会把所有 Spring 配置加载到同一个容器中。

## 第七章：Spring MVC 控制层配置（Controller 层）
### 7.1 spring-mvc.xml 配置
```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:mvc="http://www.springframework.org/schema/mvc"
       xmlns:context="http://www.springframework.org/schema/context"
       xsi:schemaLocation="
         http://www.springframework.org/schema/beans
         https://www.springframework.org/schema/beans/spring-beans.xsd
         http://www.springframework.org/schema/mvc
         https://www.springframework.org/schema/mvc/spring-mvc.xsd
         http://www.springframework.org/schema/context
         https://www.springframework.org/schema/context/spring-context.xsd">

    <!-- 1. 扫描控制器 -->
    <context:component-scan base-package="com.yourcompany.controller"/>

    <!-- 2. 开启MVC注解驱动，自动注册HandlerMapping和HandlerAdapter -->
    <mvc:annotation-driven/>

    <!-- 3. 静态资源处理（css, js, 图片等） -->
    <mvc:default-servlet-handler/>

    <!-- 4. 视图解析器 -->
    <bean class="org.springframework.web.servlet.view.InternalResourceViewResolver">
        <property name="prefix" value="/WEB-INF/jsp/"/>
        <property name="suffix" value=".jsp"/>
    </bean>
</beans>
```
### 7.2 编写 UserController
controller 包下：

```java
package com.yourcompany.controller;

import com.yourcompany.pojo.User;
import com.yourcompany.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/user")
public class UserController {

    @Autowired
    private UserService userService;

    // 查询全部用户，返回列表页
    @GetMapping("/list")
    public String list(Model model) {
        model.addAttribute("userList", userService.findAll());
        return "userList";
    }

    // 跳转到添加页面
    @GetMapping("/toAdd")
    public String toAdd() {
        return "addUser";
    }

    // 添加用户
    @PostMapping("/add")
    public String addUser(User user) {
        userService.add(user);
        return "redirect:/user/list";
    }

    // 跳转到编辑页面（回显数据）
    @GetMapping("/toEdit/{id}")
    public String toEdit(@PathVariable("id") Integer id, Model model) {
        model.addAttribute("user", userService.findById(id));
        return "editUser";
    }

    // 更新用户
    @PostMapping("/edit")
    public String editUser(User user) {
        userService.modify(user);
        return "redirect:/user/list";
    }

    // 删除用户
    @GetMapping("/delete/{id}")
    public String delete(@PathVariable("id") Integer id) {
        userService.remove(id);
        return "redirect:/user/list";
    }
}
```
## 第八章：web.xml 整合核心入口
SSM 的核心是 web.xml，在这里加载 Spring 和 Spring MVC 的配置。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee
         http://xmlns.jcp.org/xml/ns/javaee/web-app_4_0.xsd"
         version="4.0">

    <display-name>ssm-demo</display-name>

    <!-- 1. 加载Spring容器（不包含SpringMVC的Bean） -->
    <context-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>classpath:spring-service.xml,classpath:spring-dao.xml</param-value>
    </context-param>

    <listener>
        <listener-class>org.springframework.web.context.ContextLoaderListener</listener-class>
    </listener>

    <!-- 2. Spring MVC 前端控制器 -->
    <servlet>
        <servlet-name>dispatcher</servlet-name>
        <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
        <init-param>
            <param-name>contextConfigLocation</param-name>
            <param-value>classpath:spring-mvc.xml</param-value>
        </init-param>
        <load-on-startup>1</load-on-startup>
    </servlet>
    <servlet-mapping>
        <servlet-name>dispatcher</servlet-name>
        <url-pattern>/</url-pattern>
    </servlet-mapping>

    <!-- 3. 字符编码过滤器 -->
    <filter>
        <filter-name>encodingFilter</filter-name>
        <filter-class>org.springframework.web.filter.CharacterEncodingFilter</filter-class>
        <init-param>
            <param-name>encoding</param-name>
            <param-value>UTF-8</param-value>
        </init-param>
    </filter>
    <filter-mapping>
        <filter-name>encodingFilter</filter-name>
        <url-pattern>/*</url-pattern>
    </filter-mapping>
</web-app>
```
关键点解释：

ContextLoaderListener 会先初始化 Spring 根容器，加载 spring-service.xml 和 spring-dao.xml，这些 Bean 是全局共享的（Service、DAO、数据源等）。

DispatcherServlet 初始化自己的 Web 子容器，加载 spring-mvc.xml，其中包含 Controller 等 Web 组件。子容器可以访问父容器的 Bean（比如在 Controller 里注入 Service），但反之不行。

第九章：编写简单的 JSP 页面（视图层）
我们在 spring-mvc.xml 配置了视图前缀 /WEB-INF/jsp/ 和后缀 .jsp，所以 Controller 返回 "userList" 会解析为 /WEB-INF/jsp/userList.jsp。

这里只贴出 userList.jsp 示例，其余的添加、编辑页面你可以参考书写（练习一下）。

```jsp
<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<html>
<head>
    <title>用户列表</title>
</head>
<body>
<h2>用户列表</h2>
<a href="${pageContext.request.contextPath}/user/toAdd">添加用户</a>
<table border="1" cellpadding="8">
    <tr>
        <th>ID</th><th>用户名</th><th>密码</th><th>年龄</th><th>操作</th>
    </tr>
    <c:forEach var="u" items="${userList}">
        <tr>
            <td>${u.id}</td>
            <td>${u.username}</td>
            <td>${u.password}</td>
            <td>${u.age}</td>
            <td>
                <a href="${pageContext.request.contextPath}/user/toEdit/${u.id}">编辑</a>
                <a href="${pageContext.request.contextPath}/user/delete/${u.id}"
                   onclick="return confirm('确认删除？')">删除</a>
            </td>
        </tr>
    </c:forEach>
</table>
</body>
</html>
```
记得引入 JSTL 依赖哦，否则 <c:forEach> 无法使用。在 pom.xml 中加上：

```xml
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>jstl</artifactId>
    <version>1.2</version>
</dependency>
```
## 第十章：启动项目验证
配置 Tomcat（建议 Tomcat 8/9），部署这个 Maven 项目。

启动后，浏览器访问 http://localhost:8080/ssm-demo/user/list（前缀根据你的上下文路径可能不同）。

如果能看到用户列表页面，并且可以正常添加、修改、删除数据，恭喜你，SSM 框架整合成功！

## 第十一章：核心功能总结（写给小白）
到现在，你应该已经完成了一个完整的 SSM 项目。我们来梳理一下它们各自干了什么，以及相互如何配合：

框架	职责	关键点
Spring	IoC容器管理Bean，DI自动注入；事务管理	@Service, @Autowired, @Transactional
Spring MVC	请求分发、参数绑定、视图渲染	@Controller, @RequestMapping, Model
MyBatis	数据库操作，SQL与对象映射	Mapper接口 + XML 或注解
整合流程：

通过 web.xml 的 ContextLoaderListener 加载 Spring 全局容器（持久层+业务层）。

DispatcherServlet 加载 Spring MVC 容器（控制器+视图解析器），它能看见父容器的 Service Bean。

spring-dao.xml 中 MapperScannerConfigurer 自动扫描 Mapper 接口，注入到 Service 中。

Controller 接收前端请求，调用 Service 处理，然后返回逻辑视图名，由视图解析器找到对应的 JSP 展示。

## 第十二章：常见问题与避坑指南
404 错误：检查 Controller 的 @RequestMapping 路径是否正确，浏览器访问的 URL 是否以项目名开头（比如 /ssm-demo/user/list）。

500 错误且提示 NoSuchBeanDefinitionException：检查包扫描配置（<context:component-scan>）是否包含了对应的包。

数据库连接失败：检查 jdbc.properties 中的地址、用户名、密码，以及 MySQL 服务是否启动，时区参数是否加了。

JSP 中 ${} 没有解析：检查是否忘了在页面顶部加 <%@ page isELIgnored="false" %>，或者使用的 Servlet 版本是否支持 EL。

事务不回滚：确认 spring-service.xml 中是否配置了 <tx:annotation-driven/>，并且 @Transactional 注解在 Service 方法上（注意是代理调用，内部调用会失效，需单独调用）。

大作业：课后练习
为 User 表增加一个 email 字段，改造整个 CRUD（包括数据库、实体、XML、页面）。

尝试不用 XML 映射，改用 MyBatis 的注解方式（如 @Select、@Insert）重写 UserMapper。

将返回结果改为 JSON，实现前后端分离的简单测试（提示：使用 @RestController 和 @ResponseBody）。

添加一个简单的登录功能，验证用户名密码，并将用户信息存入 Session（使用 HttpSession）。