# VsingerStudio

## 项目简介

VsingerStudio 是一个面向本地部署场景的虚拟歌手生成平台，围绕“虚拟歌手档案管理 + 音乐生成 + 音色训练 + 作品归档”构建完整应用流程。项目以 ACE-Step 1.5 作为核心音乐生成引擎，结合 React、TypeScript、Node.js 与 SQLite 等技术，实现从文本描述、歌词输入到完整歌曲生成、管理和回放的可视化创作环境。

本项目的目标不是单纯封装模型推理入口，而是构建一个更贴近真实创作流程的应用系统。用户可以在平台内创建多个虚拟歌手，为不同歌手维护风格标签、默认语言、角色设定与绑定音色，并在创作时直接选择目标歌手完成歌曲生成，从而形成“歌手驱动”的创作与管理模式。

## 项目定位

本系统聚焦以下几个问题：

- 降低 AI 音乐创作门槛，让非专业用户也能通过自然语言与可视化界面完成创作。
- 将虚拟歌手管理、音色训练、歌曲生成和作品归档整合到统一平台中。
- 提供本地部署能力，便于模型调用、数据管理和实验验证。
- 提升音乐生成过程的可控性，支持风格、歌词、时长、语言、调性、节拍等参数设置。

## 核心功能

### 1. 创作中心

创作模块是平台的核心入口，支持用户通过文本描述和结构化参数生成歌曲。

- 支持输入歌曲描述、风格标签、标题和歌词。
- 支持设置人声/纯音乐模式。
- 支持选择虚拟歌手，并在生成时自动加载其已绑定音色。
- 支持设置演唱语言、目标时长、BPM、调式、拍号等控制参数。
- 支持参考音频、源音频上传，可扩展到 cover、audio2audio、局部重绘等任务类型。
- 支持生成结果回放、复用提示词再次生成。

### 2. 虚拟歌手管理

平台以“虚拟歌手”作为核心业务实体，通过管理模块维护歌手档案与音色绑定关系。

- 支持虚拟歌手的新增、编辑、删除与列表查询。
- 支持维护歌手姓名、曲风标签、默认语言、性别、角色设定、备注、头像等信息。
- 支持查看当前歌手是否已经绑定有效音色。
- 支持训练结果导出后与指定歌手建立一对一有效音色绑定。

### 3. 训练工作台

训练模块负责完成数据集构建、样本校验、预处理、训练、导出与绑定的完整闭环。

- 支持批量上传训练音频并构建数据集 JSON。
- 支持样本预览、歌词修订、描述修订与逐条保存。
- 支持自动标注、数据预处理和张量目录配置。
- 支持配置 rank、alpha、dropout、learning rate、epochs、batch size 等训练参数。
- 支持导出训练结果，并绑定到已有虚拟歌手或新建歌手。

### 4. 音乐库与作品管理

生成结果不会停留在一次性输出，而是进入可持续管理的作品库。

- 支持歌曲历史记录管理与分类展示。
- 支持按歌曲、歌手维度检索作品。
- 支持点赞、歌单、作品详情展示与播放控制。
- 支持记录歌曲与虚拟歌手之间的关联关系，便于后续归档与统计。

### 5. 本地化数据与任务管理

系统在本地环境中维护用户、任务、作品和歌手信息，保证平台具有完整的业务闭环。

- 支持本地用户初始化与会话鉴权。
- 支持生成任务状态追踪与轮询查询。
- 支持歌曲元数据、训练元数据、歌手信息和绑定信息的持久化存储。

## 系统架构

项目采用典型的 B/S 架构，整体分为前端展示层、后端业务层、数据存储层、AI 生成引擎层与音频处理层。

### 前端展示层

- 基于 React + TypeScript 构建单页面应用。
- 提供创作页、音乐库、虚拟歌手管理页、训练页等可视化界面。
- 负责参数采集、任务提交、结果展示、播放器交互与状态同步。

### 后端业务层

- 基于 Node.js + Express + TypeScript 提供 REST API。
- 负责歌曲生成任务提交、歌手管理、训练流程编排、文件上传、鉴权和数据读写。
- 通过服务层对接 ACE-Step 1.5 推理接口与训练接口。

### 数据存储层

- 采用 SQLite 进行本地持久化存储。
- 当前核心数据表包括 `users`、`songs`、`generation_jobs`、`virtual_singers`、`singer_voice_binding`、`reference_tracks`、`playlists` 等。
- 实现用户、歌曲、生成任务、虚拟歌手、音色绑定关系之间的结构化关联。

### AI 生成引擎层

- 以 ACE-Step 1.5 作为底层音乐生成模型。
- 后端通过 `@gradio/client` 与本地模型服务通信。
- 支持文本生成音乐、任务状态查询、训练集加载、训练启动与训练结果导出等能力。

### 音频处理层

- 使用 FFmpeg 进行音频转码与格式处理。
- 支持接入 Demucs 等音源分离能力，为后续人声与伴奏分轨预留处理链路。
- 提供参考音频上传、音频播放、样本预览与后续音频处理支持。

## 技术栈

| 层级 | 技术/工具 | 作用 |
| --- | --- | --- |
| 前端 | React 19 | 构建单页面交互界面 |
| 前端 | TypeScript | 提升前端类型安全与可维护性 |
| 前端 | Vite | 前端开发与构建工具 |
| 前端 | Lucide React | 图标组件库 |
| 后端 | Node.js | 服务端运行环境 |
| 后端 | Express | HTTP API 与中间件管理 |
| 后端 | TypeScript | 服务端业务开发 |
| 后端 | Multer | 处理训练音频和参考音频上传 |
| 后端 | JSON Web Token | 本地会话鉴权 |
| 数据层 | SQLite | 本地数据持久化 |
| 数据层 | better-sqlite3 | SQLite 高性能访问库 |
| 模型接入 | ACE-Step 1.5 | 核心音乐生成引擎 |
| 模型接入 | @gradio/client | 对接本地模型服务接口 |
| 音频处理 | FFmpeg | 音频格式转换与处理 |
| 音频处理 | Demucs | 音源分离与人声处理扩展 |
| 训练流程 | Python | 数据预处理与模型训练调用 |

## 业务流程

系统的典型运行流程如下：

1. 用户在前端输入歌词或歌曲描述，并选择目标虚拟歌手及风格参数。
2. 前端将生成请求发送到后端接口。
3. 后端创建生成任务并写入本地数据库。
4. 后端调用本地 ACE-Step 1.5 服务执行音乐生成。
5. 生成完成后，系统保存音频路径、歌词、描述、时长和歌手快照等元数据。
6. 前端轮询任务状态并展示结果，用户可播放、复用、收藏或归档生成作品。

训练流程如下：

1. 上传音频样本并构建数据集。
2. 对样本进行预览、修正和自动标注。
3. 执行预处理生成训练所需张量数据。
4. 启动训练并导出音色结果。
5. 将导出的音色绑定到指定虚拟歌手。
6. 回到创作模块直接使用该歌手进行生成。

## 项目目录

```text
VsingerStudio/
├── app/                 # 前端应用与模型相关目录
│   ├── components/      # 前端核心组件
│   ├── context/         # 认证、响应式、国际化上下文
│   ├── services/        # 前端接口封装
│   ├── server/          # Node.js 后端服务
│   └── ACE-Step-1.5/    # 本地模型与训练相关目录
├── 论文/                # 毕设相关文档资料
└── README.md
```

## 本地部署说明

### 环境要求

- Node.js 18 及以上
- npm
- Python 3.11
- FFmpeg
- 可正常运行的本地 ACE-Step 1.5 环境

### 1. 启动模型服务

请先在本地启动 ACE-Step 1.5，并确保模型服务接口可访问，例如：

```bash
acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

### 2. 启动后端服务

```bash
cd app/server
npm install
npm run db:migrate
npm run dev
```

默认后端地址为：

```text
http://127.0.0.1:3001
```

### 3. 启动前端应用

```bash
cd app
npm install
npm run dev
```

默认前端地址为：

```text
http://127.0.0.1:5173
```

## 主要接口

### 认证与用户

- `POST /api/auth/setup`
- `GET /api/auth/auto`
- `GET /api/auth/me`

### 音乐生成

- `POST /api/generate`
- `GET /api/generate/status/:jobId`
- `GET /api/generate/history`
- `POST /api/generate/upload-audio`

### 虚拟歌手管理

- `GET /api/singers`
- `POST /api/singers`
- `PATCH /api/singers/:id`
- `DELETE /api/singers/:id`

### 训练流程

- `POST /api/training/upload-audio`
- `POST /api/training/build-dataset`
- `POST /api/training/load-dataset`
- `GET /api/training/sample-preview`
- `POST /api/training/save-sample`
- `POST /api/training/auto-label`
- `POST /api/training/preprocess`
- `POST /api/training/start`
- `POST /api/training/export`
- `POST /api/training/bind-voice`

## API 调用示例

默认后端接口地址：

```text
http://127.0.0.1:3001
```

### JavaScript

```javascript
const base = "http://127.0.0.1:3001";

const authRes = await fetch(`${base}/api/auth/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "localuser" })
});
const { token } = await authRes.json();

const singerRes = await fetch(`${base}/api/singers`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    name: "测试歌手",
    styleTags: ["流行", "抒情"],
    defaultLanguage: "zh",
    personaPrompt: "清澈、柔和、偏抒情"
  })
});
const { singer } = await singerRes.json();

const jobRes = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  },
  body: JSON.stringify({
    customMode: false,
    songDescription: "一首清新的中文流行歌曲",
    style: "流行, 抒情",
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
        "styleTags": ["流行", "抒情"],
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
        "songDescription": "一首清新的中文流行歌曲",
        "style": "流行, 抒情",
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
  -d '{"name":"测试歌手","styleTags":["流行","抒情"],"defaultLanguage":"zh"}'
```

```bash
curl -X POST http://127.0.0.1:3001/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"customMode":false,"songDescription":"一首清新的中文流行歌曲","style":"流行, 抒情","title":"平台测试","lyrics":"","instrumental":false,"vocalLanguage":"zh","singerId":"YOUR_SINGER_ID","duration":45}'
```

## 项目价值

VsingerStudio 将开源音乐大模型与完整应用系统结合，不仅实现了音乐生成能力的本地化落地，也通过“虚拟歌手档案 + 音色绑定 + 作品归档”的设计，将一次性生成能力扩展为可持续使用、可管理、可训练、可复用的创作平台。这也是本项目作为毕业设计的重要实践价值所在。
