// 图库里的一张图。path 是存储 key，用 assetUrl() 转成 URL。
export type ImageKind = "upload" | "normalized" | "edited";
export interface ItemImage {
  id: string;
  kind: ImageKind;
  path: string;
  prompt?: string; // 编辑图所用指令
  source_id?: string; // 由哪张图派生
}

export interface Item {
  id: string;
  name: string;
  gender: string; // female / male / unisex
  category: string;
  color: string[]; // 主色在前，≤3
  season: string[];
  description: string;
  images: ItemImage[];
  primary_image_id: string | null;
  primary_path: string; // 后端派生：主图 key（封面 / 选款 / 换装都用它）
  created_at: string;
  source?: "example" | "personal";
  // 后台生成任务（只在衣橱 / 单品页接口里带）：进行中的 + 失败了还没关掉提示的
  jobs?: ItemJob[];
}

/** 单品图的后台生成任务（标准照 / 自定义编辑）。完成后结果图的 id 就是任务 id。 */
export interface ItemJob {
  id: string;
  kind: "item_normalize" | "item_edit";
  status: "pending" | "running" | "done" | "failed";
  error: string;
  source_image_id: string;
  prompt: string;
  created_at: string;
}

/** 单品页可以单独改的字段（PATCH 只传要改的）。 */
export type ItemPatch = Partial<Pick<Item, "name" | "gender" | "category" | "color" | "season" | "description">>;

// 新建/编辑单品的入参
export interface ItemInput {
  name: string;
  gender: string;
  category: string;
  color: string[];
  season: string[];
  description: string;
  images: ItemImage[];
  primary_image_id: string | null;
}

// 自动打标返回的结构化字段（预填进表单）
export interface TagResult {
  name: string;
  gender: string;
  category: string;
  color: string[];
  season: string[];
  description: string;
}

// 当前用户（= 家庭版的「模特」）
export interface Me {
  id: string;
  name: string;
  gen_base: string | null; // 生图底图（已回落到第一张照片）
  photos: string[];
  gender: "female" | "male" | "";
  age: number | null; // AI 估计的默认值，用户可改
  height_cm: number | null;
  onboarding_completed: boolean;
}

export interface Outfit {
  id: string;
  note: string;
  created_at: string;
  items: Item[];
  generations?: Generation[];
}

// 实际发给生图接口的提示词（single 模式一条，serial 模式每件一条）
export interface DressStep {
  item: string;
  prompt: string;
}

export interface Generation {
  id: string;
  outfit_id: string;
  status: "pending" | "running" | "done" | "failed";
  result_path: string | null;
  params: {
    total?: number;
    done?: number;
    current?: string;
    error?: string;
    base?: string; // 底图 key，供前后对比
    model?: string;
    mode?: "single" | "serial";
    prompts?: DressStep[];
  };
  created_at: string;
}

export interface ExampleItem {
  id: string;
  name: string;
  category: string;
  image_url: string;
}

export interface OnboardingScene {
  id: string;
  name: string;
  hint: string;
  item_ids: string[];
  items: ExampleItem[];
  recommended: boolean;
}

// 选款流水线的中间产物，每一段对应「推理过程」面板的一节
export interface PromptPreview {
  system: string;
  user: string;
}

export interface ValidationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface EnrichedResult {
  items: Item[];
  reason: string;
  confidence: number | null;
}

/**
 * 能不能开始 AI 搭配：衣橱能搭出至少 outfits.need 套（套数 = 上衣 × 下装 + 整身）。
 * missing 是最少还要补的，给用户看，如「下装 1 件」。
 */
export interface RecommendReadiness {
  ready: boolean;
  outfits: { have: number; need: number };
  tops: number;
  bottoms: number;
  one_pieces: number;
  missing: string[];
  item_count: number;
}

export interface RecommendResponse {
  prompt: PromptPreview;
  model: string;
  raw_output: string | null;
  validation: ValidationCheck[] | null;
  passed?: boolean;
  enriched: EnrichedResult | null;
  prefiltered?: {
    excluded_categories: string[];
    season?: {
      target: string[];
      source: "text" | "date";
      excluded_count: number;
    } | null;
  };
  retried?: boolean;
  error?: string;
}
