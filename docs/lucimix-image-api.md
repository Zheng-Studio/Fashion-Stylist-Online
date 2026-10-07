# Lucimix Image API 接入说明：Doubao Seedream 与 GPT Image 2

本文记录通过 Lucimix 网关调用 Doubao Seedream 和 GPT Image 2 的已验证方式。Lucimix 是访问入口，具体参数和能力由所选模型决定；不要假设不同模型的参数完全相同。

## 基本信息

接口地址：

```text
https://bizapi.lucimix.com/v1/images/generations
```

请求头：

```http
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

模型：

```text
doubao-seedream-4.5
```

API key 应通过环境变量或密钥管理系统提供，不要写入代码或提交到 Git。

## 文生图

请求体：

```json
{
  "model": "doubao-seedream-4.5",
  "prompt": "一只白色陶瓷杯，白色背景，产品摄影",
  "n": 1
}
```

Python 示例：

```python
import os

import httpx


response = httpx.post(
    "https://bizapi.lucimix.com/v1/images/generations",
    headers={"Authorization": f"Bearer {os.environ['IMAGE_API_KEY']}"},
    json={
        "model": "doubao-seedream-4.5",
        "prompt": "一只白色陶瓷杯，白色背景，产品摄影",
        "n": 1,
    },
    timeout=300,
)
response.raise_for_status()
image_url = response.json()["data"][0]["url"]
```

## 关于兼容性

调用链路可以理解为：调用方 -> Lucimix 网关 -> Doubao Seedream 模型。Lucimix 网关提供相似的 URL、鉴权方式和 JSON 结构，让已有 OpenAI 风格代码可以接入；但具体模型能力和参数名称由 Seedream 模型协议决定。

因此，“OpenAI 兼容”只代表基础协议相似，不代表所有 SDK 方法和参数都完全相同。本文的 `image`、`sequential_image_generation` 等字段是 Seedream 的模型参数，不是 Lucimix 所有模型的通用参数。接入其他模型时应重新查阅对应模型的官方文档。

这也解释了为什么请求可能返回成功但结果不正确：网关可能接受请求并忽略不认识的可选字段，模型仍能根据 prompt 生成结果。HTTP 200 只能说明请求完成，不代表每个输入参数都生效。

## GPT Image 2

GPT Image 2 使用同一个图片生成端点：

```text
POST https://bizapi.lucimix.com/v1/images/generations
```

Lucimix 模型列表中的两个模型 ID：

```text
gpt-image-2-medium
gpt-image-2-high
```

文生图请求示例：

```json
{
  "model": "gpt-image-2-medium",
  "prompt": "一只白色陶瓷杯，纯色背景，产品摄影",
  "size": "3840x2160",
  "n": 1
}
```

`size` 使用明确的 `宽x高` 像素值。已实测成功的尺寸如下；medium 和 high 都成功支持前三种及 `3840x2160`，medium 另测成功 `2336x3504`、`1664x2496`，high 另测成功 `2448x3264`：

| 尺寸 | 比例/用途 | medium | high |
|---|---|---|---|
| `1024x1024` | 方图 | 已测成功 | 已测成功 |
| `896x1120` | 竖图 | 已测成功 | 已测成功 |
| `1120x896` | 横图 | 已测成功 | 已测成功 |
| `2336x3504` | 2:3 竖图 | 已测成功 | 未测 |
| `1664x2496` | 2:3 竖图 | 已测成功 | 未测 |
| `2448x3264` | 3:4 竖图 | 未测 | 已测成功 |
| `3840x2160` | UHD 横图 | 已测成功 | 已测成功 |

以下两个尺寸已实际请求并被拒绝：`1024x1536`、`1536x1024`。应使用网关支持列表中的精确尺寸，不要仅凭常见比例自行换算。

网关错误响应公布的 GPT Image 2 尺寸白名单共 30 项。除上表中已测成功的 7 个尺寸以外，其余 23 项目前只有网关白名单信息，尚未逐项生成验证：

```text
1152x864, 864x1152,
1248x832, 832x1248, 1280x720, 720x1280, 1456x624,
2048x2048, 2240x1792, 1792x2240, 2304x1728, 1728x2304,
2496x1664, 2560x1440, 1440x2560, 3024x1296,
2880x2880, 3200x2560, 2560x3200, 3264x2448,
3504x2336, 2160x3840, 3696x1584
```

本节验证范围是文生图及尺寸参数。虽然模型列表标记了 `image_gen` 能力，但本次没有验证 GPT Image 2 的参考图/图生图请求；不要直接套用 Seedream 的 `image` 参数。

## 图生图

参考图使用请求体中的 `image` 字段。单张参考图时传字符串，多张参考图时传数组。

图片可以使用公网 URL 或 data URL：

```text
data:image/jpeg;base64,<BASE64_DATA>
```

多图请求示例：

```json
{
  "model": "doubao-seedream-4.5",
  "prompt": "根据输入的参考图生成一张新的图片，保留参考图中的主体特征和关键细节",
  "image": [
    "data:image/jpeg;base64,<REFERENCE_IMAGE_A>",
    "data:image/jpeg;base64,<REFERENCE_IMAGE_B>",
    "data:image/jpeg;base64,<REFERENCE_IMAGE_C>"
  ],
  "n": 1,
  "sequential_image_generation": "disabled"
}
```

多图场景建议约定图片顺序：

```text
image[0] = 主要参考图
image[1...] = 其他参考图
```

Seedream 4.5 的多图生图支持 2 到 14 张参考图。提示词中应明确说明每张图片的用途，以及需要保持或改变的内容。

Python 示例：

```python
import base64
import os
from pathlib import Path

import httpx


def to_data_url(path: str) -> str:
    encoded = base64.b64encode(Path(path).read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


response = httpx.post(
    "https://bizapi.lucimix.com/v1/images/generations",
    headers={"Authorization": f"Bearer {os.environ['IMAGE_API_KEY']}"},
    json={
        "model": "doubao-seedream-4.5",
        "prompt": "根据图1、图2和图3生成一张新图片，保留各参考图中指定的主体特征和关键细节",
        "image": [
          to_data_url("reference_a.jpg"),
          to_data_url("reference_b.jpg"),
          to_data_url("reference_c.jpg"),
        ],
        "n": 1,
        "sequential_image_generation": "disabled",
    },
    timeout=300,
)
response.raise_for_status()
image_url = response.json()["data"][0]["url"]
```

## 响应处理

典型响应：

```json
{
  "model": "doubao-seedream-4-5-251128",
  "data": [
    {
      "url": "https://...signed-url..."
    }
  ],
  "usage": {
    "generated_images": 1
  }
}
```

返回的 `url` 通常是带签名的临时地址。服务端应立即下载并保存到自己的对象存储或文件存储，不要把它当作永久地址保存。

兼容实现也可能返回 `b64_json`，处理时可优先读取 `b64_json`，否则下载 `url`。

## 推荐的接入验证顺序

不要只验证“是否返回 200”。建议按下面顺序逐层确认：

1. **连通性**：确认域名、`/v1` 路径和 API key 正确。
2. **模型能力**：确认模型名称正确，并确认它支持文生图、单图生图或多图生图。
3. **协议字段**：严格按官方文档使用字段名，例如参考图字段是 `image`，不是相近的 `images`。
4. **最小请求**：先用文生图确认模型和返回解析，再用单张参考图确认图生图。
5. **多图请求**：逐步增加参考图，检查图片顺序、数量限制和提示词中的图号是否一致。
6. **结果语义**：检查输出是否真的保留了参考图中的主体和细节，而不只是检查有没有返回图片。

## 常见协议差异

- 生图使用 `/images/generations`，不一定提供 `/images/edits`。
- 参考图可能使用 JSON 字段 `image`，不一定使用 `images` 或 multipart 文件字段。
- 同一个字段在单图时可能是字符串，多图时可能必须是数组。
- 返回值可能是临时 `url`，也可能是 `b64_json`，接入方应兼容两种格式。
- 网关可能对未知字段不报错，因此字段拼写错误不一定会得到 4xx。

## 注意事项

- 使用 `/v1/images/generations`，不是 `/v1/images/edits`。
- 参考图字段是 `image`，多图时传数组；不要使用 `images`。
- `image` 为多图数组时，确保图片顺序与提示词中的“图1、图2……”一致。
- `sequential_image_generation: disabled` 用于一次生成一张结果图。
- HTTP 200 只代表接口返回了结果，不代表参考图一定被正确使用；应检查输出中的主体和关键细节。
