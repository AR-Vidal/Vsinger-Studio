# ACE-Step 虚拟歌手生成平台

这是当前项目应用层的说明文档。

当前版本的重点已经从“手动 LoRA 面板”转成了“虚拟歌手平台”：

- `创作`
- `音乐库`
- `管理`
- `训练`

其中“虚拟歌手”是核心实体，训练得到的音色通过绑定关系接入创作流程，前端不再让用户手动输入 LoRA 路径。

---

## 当前功能

### 1. 创作

- 中文界面
- 纯音乐 / 人声一键切换
- 人声生成时可选择已绑定音色的虚拟歌手
- 纯音乐模式不要求选择歌手
- 保留高级控制区：
  - 标题
  - 歌词
  - 参考音频
  - 源音频
  - 专家参数

### 2. 音乐库

- 搜索已并入音乐库
- 支持按歌曲名和歌手名搜索
- 列表显示歌手快照名
- 保留：
  - 全部歌曲
  - 喜欢
  - 歌单

### 3. 管理

- 以列表方式维护虚拟歌手基础信息
- 支持增删改查
- 字段包括：
  - 姓名
  - 曲风标签
  - 默认语言
  - 角色设定
  - 备注
  - 头像 URL

### 4. 训练

- 上传训练音频
- 构建数据集 JSON
- 样本预览与编辑
- 预处理
- 启动训练
- 导出音色
- 绑定到已有歌手
- 跳转管理页新建歌手后自动绑定

当前约束：

- 一个歌手只能保留一条当前生效音色
- 新音色绑定成功后，会替换旧绑定

---

## 新手测试数据集指南

如果你之前没做过 LoRA 训练，建议先做“最小可验证数据集”，目标不是一步到位，而是先确认流程跑通。

### 最推荐的新手测试集

- 单一歌手
- `15 到 30` 条切片
- 总时长 `10 到 20` 分钟
- 每条 `8 到 20` 秒
- 干净独唱
- 发音清晰
- 伴奏轻或已分离人声

### 训练效果最关键的不是“多”，而是“干净”

优先保证这些条件：

- 不混入第二个声音
- 不要有明显观众声或环境噪声
- 不要把整首混音歌曲直接全塞进去
- 不要把说话、唱歌、直播、采访混成一套数据

### 对这个项目最友好的文件组织方式

训练接口当前支持：

- `.wav`
- `.mp3`
- `.flac`
- `.ogg`
- `.opus`

推荐目录示例：

```text
my_test_dataset/
  001.wav
  001.txt
  002.wav
  002.txt
  003.wav
  003.txt
```

说明：

- `.txt` 文件和音频同名
- 文本内容写这一小段音频实际对应的歌词
- 如果没有 `.txt`，人声样本的可读性和后续整理会差很多

### 最容易上手的素材来源

推荐顺序：

1. 自己录一组人声
2. 自己拥有版权或授权的清唱素材
3. 从完整歌曲中先做人声分离，再手动筛出干净片段

如果你只是为了测试项目工作流，自己录音通常是最快、最干净、最容易验证结果的一种方式。

---

## 新手训练教程

### 第 1 步：先新建歌手

进入 `管理` 页面，先创建一个虚拟歌手。

建议至少填写：

- 姓名
- 曲风标签
- 默认语言
- 角色设定

### 第 2 步：准备音频和歌词

第一次建议这样准备：

- `20` 条左右音频
- 每条 `10 到 15` 秒
- 同一个歌手
- 同一种主要语言
- 每条对应一份 `.txt`

### 第 3 步：进入训练页上传音频

在 `训练 -> 数据集` 中：

1. 输入数据集名称
2. 选择音频文件
3. 点击“上传并构建”

系统会：

- 保存音频
- 扫描数据集
- 生成 JSON
- 返回第一条样本预览

### 第 4 步：检查样本

在样本预览阶段重点看：

- 文件名是否对应正确
- 歌词有没有错位
- 有没有误把人声当器乐
- 有没有混进脏样本

### 第 5 步：开始预处理

预处理会把音频转换成训练阶段可直接使用的中间数据。

### 第 6 步：先跑一轮小训练

第一次只做烟雾测试，建议：

- `rank`: 32 或 64
- `alpha`: 64 或 128
- `dropout`: 0.05 到 0.1
- `learningRate`: 0.0003
- `batchSize`: 1
- `epochs`: 200 到 500
- `saveEvery`: 100 到 200

如果只是为了看系统是否工作正常，这样已经够用。

### 第 7 步：导出并绑定

训练完成后：

1. 点击导出
2. 选择已有歌手并绑定
3. 如果歌手已有旧音色，确认覆盖即可

也可以：

1. 从训练页点击“去管理页新建并自动绑定”
2. 新建歌手
3. 保存后自动绑定刚导出的结果

### 第 8 步：回到创作页验证

建议用最短路径验证：

1. 进入 `创作`
2. 关闭纯音乐模式
3. 选择已绑定歌手
4. 写一段简单中文提示词
5. 先生成 `30 到 60` 秒

如果你能明显听出这位歌手的音色倾向，说明训练和绑定已经接通了。

---

## 常见失败原因

### 数据太杂

多歌手、多场景、多语言一起混，会让音色变脏。

### 样本太长

长音频会增加整理难度，新手更适合先切成短片段。

### 歌词缺失

没有 `.txt` 对齐歌词时，样本检查和后续修正成本会明显升高。

### 一开始就训练很久

第一次先做小训练，确认链路无误再扩大规模。

---

## 开发启动

### 前置要求

- Node.js 18+
- Python 3.11
- `uv`
- FFmpeg
- 可运行的 ACE-Step 1.5 环境

### 1. 启动 ACE-Step API

示例：

```bash
acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

### 2. 启动后端

```bash
cd app/server
npm install
npm run db:migrate
npm run dev
```

### 3. 启动前端

```bash
cd app
npm install
npm run dev
```

默认开发地址：

- 前端：`http://127.0.0.1:3000`
- 后端：`http://127.0.0.1:3001`

---

## 关键接口

### 认证

- `POST /api/auth/setup`
- `GET /api/auth/auto`
- `GET /api/auth/me`

### 创作

- `POST /api/generate`
- `GET /api/generate/status/:jobId`
- `GET /api/generate/history`
- `POST /api/generate/upload-audio`

### 歌手管理

- `GET /api/singers`
- `POST /api/singers`
- `PATCH /api/singers/:id`
- `DELETE /api/singers/:id`

### 训练

- `POST /api/training/upload-audio`
- `POST /api/training/build-dataset`
- `POST /api/training/load-dataset`
- `GET /api/training/sample-preview`
- `POST /api/training/save-sample`
- `POST /api/training/preprocess`
- `POST /api/training/start`
- `POST /api/training/export`
- `POST /api/training/bind-voice`

---

## API 示例

默认后端地址：

```text
http://127.0.0.1:3001
```

### JavaScript

```javascript
const base = "http://127.0.0.1:3001";

// 1. 创建本地用户
const authRes = await fetch(`${base}/api/auth/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "localuser" })
});
const { token } = await authRes.json();

// 2. 新建歌手
const singerRes = await fetch(`${base}/api/singers`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    name: "测试歌手",
    styleTags: ["流行", "梦幻"],
    defaultLanguage: "zh",
    personaPrompt: "清澈、柔和、偏抒情"
  })
});
const { singer } = await singerRes.json();

// 3. 发起生成
const jobRes = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    customMode: false,
    songDescription: "一首清新的中文流行歌，带一点梦幻感",
    style: "流行, 梦幻",
    title: "平台测试",
    lyrics: "",
    instrumental: false,
    vocalLanguage: "zh",
    singerId: singer.id,
    duration: 45
  })
});
const job = await jobRes.json();
console.log(job);
```

### Python

```python
import requests

base = "http://127.0.0.1:3001"

auth = requests.post(
    f"{base}/api/auth/setup",
    json={"username": "localuser"}
)
auth.raise_for_status()
token = auth.json()["token"]

singer = requests.post(
    f"{base}/api/singers",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "name": "测试歌手",
        "styleTags": ["流行", "梦幻"],
        "defaultLanguage": "zh",
        "personaPrompt": "清澈、柔和、偏抒情"
    }
)
singer.raise_for_status()
singer_id = singer.json()["singer"]["id"]

job = requests.post(
    f"{base}/api/generate",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "customMode": False,
        "songDescription": "一首清新的中文流行歌，带一点梦幻感",
        "style": "流行, 梦幻",
        "title": "平台测试",
        "lyrics": "",
        "instrumental": False,
        "vocalLanguage": "zh",
        "singerId": singer_id,
        "duration": 45
    }
)
job.raise_for_status()
print(job.json())
```

### Curl

```bash
curl -X POST http://127.0.0.1:3001/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"localuser"}'
```

```bash
curl -X POST http://127.0.0.1:3001/api/singers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"测试歌手","styleTags":["流行","梦幻"],"defaultLanguage":"zh"}'
```

```bash
curl -X POST http://127.0.0.1:3001/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"customMode":false,"songDescription":"一首清新的中文流行歌","style":"流行, 梦幻","title":"平台测试","lyrics":"","instrumental":false,"vocalLanguage":"zh","singerId":"YOUR_SINGER_ID","duration":45}'
```

---

## 备注

当前前端已经同步到现有状态：

- 中文文案
- 无深浅模式切换
- 设置页已移除语言切换、外观切换、关注和 GitHub 按钮
- 虚拟歌手工作流已接入创作 / 管理 / 训练 / 音乐库
