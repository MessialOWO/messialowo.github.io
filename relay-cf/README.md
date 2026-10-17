# Cloudflare Pages 中转站部署

> 为什么不用 Cloudflare Workers？
> 因为 `*.workers.dev` 在中国大陆被墙，而 `*.pages.dev` 可以正常访问。

## 一、注册（5 分钟）

1. 打开 https://dash.cloudflare.com/sign-up
2. 邮箱 + 密码注册（**不需要绑卡**）
3. 注册完收邮件验证

## 二、创建 Pages 项目

1. 登录后，左侧菜单点 **Workers & Pages**
2. 点 **Create**（或 Create application）
3. 选 **Pages** 标签 → **Upload assets**
4. 项目名随便填，比如 `jw-relay`
   - 最终网址会是 `https://jw-relay.pages.dev`
   - 这个名字决定了网址，改不了，选好再建
5. 创建后进入项目

## 三、上传中转代码

1. 在项目页面点 **Create new deployment**
2. 把你的文件打包上传：
   - 只需要 `_worker.js` 这一个文件
   - 把它压缩成 zip（文件名随意，如 `relay.zip`，里面直接是 `_worker.js`）
3. 上传 zip，点 **Save and Deploy**
4. 等 10 秒左右，显示 Success

## 四、验证是否成功

浏览器打开：

```
https://你的项目名.pages.dev/
```

应该看到：
```
班级网站中转站运行中

可用路径：/rest/v1/*  /auth/v1/*  /storage/v1/*
```

再测一个真实接口：

```
https://你的项目名.pages.dev/rest/v1/gb_sections?select=name&limit=3
```

应该返回 JSON（分区列表）。

## 五、把地址告诉我

把 `https://你的项目名.pages.dev` 发给我，我把它加到网站的中转列表里。

前端会自动在这几条线路间选择：
- 直连 Supabase（最快，不消耗中转）
- Deno 中转（原来的）
- **Cloudflare 中转（新的）**

## 免费额度

| 项目 | 免费额度 |
|---|---|
| 请求数 | **无限** |
| 带宽 | **无限** |
| 构建次数 | 500 次/月 |
| 文件数 | 20000 个/项目 |
| 单文件 | 25 MB |

对这个小站来说，**完全够用，而且不会像 Deno 那样用完就停**。

## 备选：用 Wrangler 命令行部署

如果你电脑上装了 Node.js：

```bash
npm create cloudflare@latest jw-relay -- --platform=pages
# 选 Pages，然后把 _worker.js 放进去
cd jw-relay
npx wrangler pages deploy . --project-name=jw-relay
```

首次会要求浏览器授权登录 Cloudflare。
