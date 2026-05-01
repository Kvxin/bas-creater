# 文本对象（Text）

## 示例

```js
def text t {
    content = "bilibili"
    fontSize = 5%
    fontFamily = "黑体"
    x = 50%
    y = 50%
    alpha = 1
    color = 0x00a1d6
    textShadow = 0
    bold = 1
    rotateX = 0
    rotateY = 0
    rotateZ = 0
    strokeWidth = 1
    strokeColor = 0xffffff
    anchorX = 0.5
    anchorY = 0.5
    zIndex = 3
    duration = 5s
}

def text y {
    content = "干杯"
    parent = "t"
    fontSize = 2%
    x = 100%
    y = 100%
}
```

## 属性

| 属性名         | 类型     | 必填 | 默认值      | 可动画 | 可渐变 | 说明         |
| ----------- | ------ | -- | -------- | --- | --- | ---------- |
| x           | number | 否  | 0        | 是   | 是   | x 坐标，可为百分比 |
| y           | number | 否  | 0        | 是   | 是   | y 坐标，可为百分比 |
| zIndex      | number | 否  | 0        | 否   | 否   | 层级         |
| scale       | number | 否  | 1        | 是   | 是   | 缩放         |
| duration    | time   | 否  | -        | 否   | 否   | 生命周期       |
| content     | string | 是  | 请输入内容    | 是   | 否   | 文本内容       |
| alpha       | number | 否  | 1        | 是   | 是   | 透明度        |
| color       | number | 否  | 0xffffff | 是   | 是   | 文本颜色       |
| anchorX     | number | 否  | 0        | 否   | 否   | 锚点 X       |
| anchorY     | number | 否  | 0        | 否   | 否   | 锚点 Y       |
| fontSize    | number | 否  | 25       | 是   | 否   | 字体大小       |
| fontFamily  | string | 否  | -        | 否   | 否   | 字体         |
| bold        | number | 否  | 1        | 否   | 否   | 是否加粗       |
| textShadow  | number | 否  | 1        | 否   | 否   | 阴影         |
| strokeWidth | number | 否  | 0        | 否   | 否   | 描边宽度       |
| strokeColor | number | 否  | 0xffffff | 否   | 否   | 描边颜色       |
| rotateX     | number | 否  | 0        | 是   | 是   | X 轴旋转      |
| rotateY     | number | 否  | 0        | 是   | 是   | Y 轴旋转      |
| rotateZ     | number | 否  | 0        | 是   | 是   | Z 轴旋转      |
| parent      | text   | 否  | -        | 否   | 否   | 父节点        |

---

# 交互按钮（Button）

## 示例

```js
def button b {
  text = "av1714157"
  x = 30%
  y = 37%
  fontSize = 5%
  textColor = 0xffffff
  fillColor = 0xFF9100
  fillAlpha = 0.8
  duration = 2s
  zIndex = 1
  scale = 0.8
  target = av {
    av = 1714157
    page = 1
    time = 20.5s500ms
  }
}
```

## 属性

| 属性名       | 类型                  | 必填 | 默认值      | 可动画 | 可渐变 | 说明    |
| --------- | ------------------- | -- | -------- | --- | --- | ----- |
| x         | number              | 否  | 0        | 是   | 是   | x 坐标  |
| y         | number              | 否  | 0        | 是   | 是   | y 坐标  |
| zIndex    | number              | 否  | 0        | 否   | 否   | 层级    |
| scale     | number              | 否  | 1        | 否   | 否   | 缩放    |
| duration  | time                | 否  | -        | 否   | 否   | 生命周期  |
| text      | string              | 是  | 请输入内容    | 是   | 否   | 按钮文字  |
| fontSize  | number              | 否  | 25       | 是   | 否   | 字体大小  |
| textColor | number              | 否  | 0x000000 | 否   | 否   | 文字颜色  |
| textAlpha | number              | 否  | 1        | 否   | 否   | 文字透明度 |
| fillColor | number              | 否  | 0xffffff | 否   | 否   | 填充颜色  |
| fillAlpha | number              | 否  | 1        | 否   | 否   | 填充透明度 |
| target    | av / bangumi / seek | 是  | -        | 否   | 否   | 点击行为  |

---

## av object

| 属性   | 类型     | 必填 | 默认值 | 说明   |
| ---- | ------ | -- | --- | ---- |
| av   | number | 是  | -   | av 号 |
| page | number | 否  | 1   | 分 P  |
| time | time   | 否  | 0s  | 播放时间 |

---

## bangumi object

| 属性        | 类型     | 必填 | 默认值 | 说明    |
| --------- | ------ | -- | --- | ----- |
| seasonId  | number | 是  | -   | 番剧 ID |
| episodeId | number | 是  | -   | 分集 ID |
| time      | time   | 否  | 0s  | 播放时间  |

---

## seek object

| 属性   | 类型   | 必填 | 默认值 | 说明   |
| ---- | ---- | -- | --- | ---- |
| time | time | 是  | -   | 跳转时间 |

---

# Path 对象

## 示例

```js
def path p {
  d = "M30.828,30.422 ..."
  viewBox = "0 0 32 34"
  x = 40%
  y = 15%
  borderWidth = 1
  borderColor = 0xffffff
  fillColor = 0x00a1d6
  width = 20%
  duration = 2s
}
```

## 属性

| 属性          | 类型     | 必填 | 默认值      | 说明     |
| ----------- | ------ | -- | -------- | ------ |
| d           | string | 是  | ""       | svg 路径 |
| borderWidth | number | 否  | 0        | 描边宽度   |
| borderColor | number | 否  | 0        | 描边颜色   |
| borderAlpha | number | 否  | 1        | 描边透明度  |
| fillColor   | number | 否  | 0xffffff | 填充颜色   |
| fillAlpha   | number | 否  | 1        | 填充透明度  |
| viewBox     | string | 否  | -        | 画布大小   |
| width       | number | 否  | -        | 宽度     |
| height      | number | 否  | -        | 高度     |

---

# 动画

## SET 语法

```text
set id { 属性 = 值 } 时间, "插值类型"
```

## 示例

```js
set t {
  x = 50%
  y = 50%
} 1s, "linear"
```

## 串联动画

```js
set a { x = 50% } 1s
then set a { alpha = 0 } 1s
```

## 并联动画

```js
set a { x = 50% } 1s
set a { alpha = 0 } 1s
```