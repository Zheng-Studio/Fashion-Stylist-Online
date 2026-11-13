// 单品录入的下拉/标签预设选项（硬编码，日后要调就改这一处）。

// 品类闭集，须与后端 backend/app/domain/taxonomy.py 的 CATEGORIES 一致。
// 品类 = 单品在搭配里的「角色」(上身内/外、下身、整身…)，不是形状；形状交给 name/description。
// 「整身」= 占满上下、当一套不可拆穿的一件式（连衣裙/连体裤/比基尼套装），slot/layer 由后端派生。
export const CATEGORIES = ["内搭", "外套", "下装", "整身", "鞋", "帽", "配饰"] as const;

export const SEASONS = ["春", "夏", "秋", "冬"] as const;

// 本人照片上限，须与后端 routers/me.py 的 MAX_PHOTOS 一致；「我」里按 3×3 排。
export const MAX_PHOTOS = 9;

// 单品适用性别。须与后端 domain/tagging.GENDERS 一致。
export const GENDERS = ["female", "male", "unisex"] as const;
export const GENDER_LABEL: Record<string, string> = {
  female: "女",
  male: "男",
  unisex: "中性",
};

// AI 编辑的快捷指令，按后端生图场景分组（见 backend/app/domain/image_scenes.py）。
// 只是帮用户填输入框的界面文案：点一下填进编辑指令框，可再改。
// 真正的提示词和兜底约束（单品里不能出现人、本人照片必须还是同一个人……）都在后端，这里不用重复。
export const EDIT_PRESETS = {
  // 单品图
  item_edit: [
    "把衣服平铺展开，去除晾衣架",
    "去除图中文字和水印",
    "换成纯白背景",
    "只保留这件衣服，去掉人物和背景",
  ],
  // 本人照片（换装底图）：刻意只动背景 / 光线，不碰人脸、身材、姿势
  photo_edit: [
    "换成纯白背景",
    "换成纯色影棚背景",
    "去除背景杂物，只保留人物",
    "统一柔和的影棚打光",
  ],
} as const;

// 编辑指令长度上限，须与后端 image_scenes.MAX_INSTRUCTION_CHARS 一致
export const MAX_EDIT_INSTRUCTION = 200;

// 注：风格标签（style_tags）概念已废弃移除——风格/场合等语义并入单品 description（自由文本），
// 不再用闭集结构化标签（与 LLM 语义理解下的 description 重复且无独立筛选用途）。
