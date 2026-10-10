# 备用中转站（Render）

## 为什么要它

主力中转是 Deno Deploy，但官方已宣布 **Deno Deploy 约 2027 年 4 月关闭**。
在那之前，先把 Render 上的备用中转部署好，到时候（或者哪天主站抽风时）
**改一行配置就能切过去**，网站不用重做。

## Render 的优势

- 免费额度：**750 小时/月**（一个服务够用）
- **不需要信用卡**
- 默认域名 `xxx.onrender.com`，国内**实测可达**（DNS + TLS 通）
- 缺点：15 分钟没人访问会休眠，下次访问约 1 分钟唤醒——所以当**备份**最合适

## 部署步骤（约 5 分钟）

1. 把 `relay/relay-render.js` 和 `relay/package.json` 放到一个**新的 GitHub 仓库**（比如 `jw-relay`）
2. 打开 https://dashboard.render.com → **Sign in with GitHub**
3. 点 **New** → **Web Service** → 选刚才那个仓库
4. 配置：
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `node relay-render.js`
   - Instance Type: **Free**
5. 点 **Create Web Service**，等 1~2 分钟
6. 复制它的网址（形如 `https://jw-relay-xxxx.onrender.com`），发我

## 我这边怎么接

`vendor/jw-client.js` 里已经是**数组**了：

```js
proxy: [
  'https://arid-bluejay-4932.messialowo.deno.net'   // 主力（Deno）
  // , 'https://jw-relay-xxxx.onrender.com'         // 备份（Render），填这里
],
```

按顺序尝试，前一个失败**自动换下一个**，全挂了再回退直连官方域名。
所以加进来只会更稳，不会更差。
