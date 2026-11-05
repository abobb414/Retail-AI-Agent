export type Department =
  | "apparel"
  | "digital"
  | "appliance"
  | "furniture"
  | "home_goods"
  | "personal_care"
  | "food"
  | "pet"
  | "baby"
  | "stationery"
  | "lighting"
  | "toys"
  | "fitness"
  | "other";
export type Gender = "male" | "female" | "child" | "unisex";

export interface RequestProfile {
  department: Department | null;
  productType: string | null;
  specificIntent: string | null;
  brand: string | null;
  gender: Gender | null;
  budget: number | null;
  size: string | null;
  screenSizeInch: number | null;
  storageGb: number | null;
}

export const DEPARTMENT_LABELS: Record<Department, string> = {
  apparel: "服饰",
  digital: "数码",
  appliance: "电器",
  furniture: "家具",
  home_goods: "家居用品",
  personal_care: "个护美妆",
  food: "食品饮料",
  pet: "宠物用品",
  baby: "母婴用品",
  stationery: "文具办公",
  lighting: "照明灯具",
  toys: "玩具",
  fitness: "运动健身",
  other: "其他",
};

const PRODUCT_TYPE_ALIASES: Array<{ type: string; department: Department; aliases: string[] }> = [
  { type: "phone", department: "digital", aliases: ["手机", "智能手机", "iphone", "smartphone"] },
  { type: "tablet", department: "digital", aliases: ["平板", "平板电脑", "ipad", "tablet"] },
  { type: "computer", department: "digital", aliases: ["笔记本", "电脑", "macbook", "laptop"] },
  { type: "monitor", department: "digital", aliases: ["显示器", "monitor"] },
  { type: "audio", department: "digital", aliases: ["耳机", "耳塞", "音箱", "音响", "buds", "headphone", "speaker"] },
  { type: "television", department: "digital", aliases: ["电视", "智能电视", "smart tv", "qled", "oled"] },
  { type: "storage_device", department: "digital", aliases: ["存储卡", "内存卡", "固态硬盘", "ssd", "硬盘"] },
  { type: "network_device", department: "digital", aliases: ["路由器", "路由", "mesh"] },
  { type: "smart_display", department: "digital", aliases: ["智能屏", "家庭屏", "智能家庭屏"] },
  { type: "media_player", department: "digital", aliases: ["dvd", "蓝光播放器", "影音播放器"] },
  { type: "wearable", department: "digital", aliases: ["手表", "智能手表", "手环", "智能戒指", "watch"] },
  { type: "digital_accessory", department: "digital", aliases: ["手机壳", "保护壳", "表带", "触控笔", "贴膜", "充电器", "数据线"] },
  { type: "camera", department: "digital", aliases: ["相机", "摄像机", "camera"] },
  { type: "air_conditioner", department: "appliance", aliases: ["空调"] },
  { type: "refrigerator", department: "appliance", aliases: ["冰箱"] },
  { type: "washer", department: "appliance", aliases: ["洗衣机", "烘干机", "洗烘"] },
  { type: "dishwasher", department: "appliance", aliases: ["洗碗机"] },
  { type: "kitchen_appliance", department: "appliance", aliases: ["烤箱", "微波炉", "咖啡机", "面包机"] },
  { type: "cleaning_appliance", department: "appliance", aliases: ["吸尘器", "扫地机", "清洁电器"] },
  { type: "personal_care", department: "appliance", aliases: ["剃须刀", "电动牙刷", "吹风机", "美容仪"] },
  { type: "shoes", department: "apparel", aliases: ["鞋", "跑步鞋", "跑鞋", "运动鞋", "训练鞋", "徒步鞋", "板鞋", "靴", "拖鞋"] },
  { type: "tops", department: "apparel", aliases: ["t恤", "短袖", "半袖", "衬衫", "上衣", "背心", "卫衣"] },
  { type: "pants", department: "apparel", aliases: ["裤", "裤子", "运动裤", "长裤", "短裤", "牛仔裤"] },
  { type: "outerwear", department: "apparel", aliases: ["外套", "夹克", "冲锋衣", "羽绒服", "风衣"] },
  { type: "dress", department: "apparel", aliases: ["裙子", "连衣裙", "半身裙"] },
  { type: "underwear", department: "apparel", aliases: ["内衣", "内裤", "文胸", "睡衣"] },
  { type: "apparel_accessory", department: "apparel", aliases: ["配件", "围巾", "口罩", "太阳镜", "眼镜", "帽子", "包袋"] },
  { type: "activewear", department: "apparel", aliases: ["瑜伽服", "瑜伽裤", "瑜伽上衣"] },
  { type: "sofa", department: "furniture", aliases: ["沙发", "sofa"] },
  { type: "bed", department: "furniture", aliases: ["床", "床架", "床垫"] },
  { type: "chair", department: "furniture", aliases: ["椅子", "座椅", "办公椅", "凳子"] },
  { type: "table", department: "furniture", aliases: ["桌子", "书桌", "办公桌", "餐桌", "茶几"] },
  { type: "storage", department: "furniture", aliases: ["收纳", "柜子", "衣柜", "置物架", "储物"] },
  { type: "tableware", department: "home_goods", aliases: ["餐具", "厨具", "咖啡壶", "茶壶", "手冲壶", "碗", "盘", "杯子", "筷子", "锅具"] },
  { type: "home_textile", department: "home_goods", aliases: ["床品", "床单", "被套", "四件套", "枕套", "靠垫", "毛巾"] },
  { type: "home_organization", department: "home_goods", aliases: ["衣架", "晾衣架", "家居收纳", "木器护理"] },
  { type: "home_decor", department: "home_goods", aliases: ["香薰", "蜡烛", "花瓶", "装饰", "地毯", "镜子"] },
  { type: "skincare", department: "personal_care", aliases: ["护肤", "面膜", "洁面", "洗发水", "沐浴露", "润唇膏"] },
  { type: "hand_care", department: "personal_care", aliases: ["护手霜", "护手"] },
  { type: "food", department: "food", aliases: ["零食", "食品", "茶", "咖啡", "饮料", "饼干", "薯片"] },
  { type: "pet_food", department: "pet", aliases: ["宠物食品", "宠物零食", "猫粮", "狗粮"] },
  { type: "baby_product", department: "baby", aliases: ["婴儿", "婴童", "宝宝", "母婴", "儿童用品", "睡袋"] },
  { type: "stationery", department: "stationery", aliases: ["文具", "笔", "文件夹", "笔袋", "卡包"] },
  { type: "lamp", department: "lighting", aliases: ["床头灯", "照明灯具", "室内照明", "台灯", "落地灯", "吊灯", "灯具", "照明", "灯", "lamp"] },
  { type: "toy", department: "toys", aliases: ["玩具", "积木", "火车轨道", "儿童玩具", "toy"] },
  { type: "exercise_equipment", department: "fitness", aliases: ["健身器材", "动感单车", "跑步机", "运动器材", "exercise bike"] },
];

const SPECIFIC_INTENT_ALIASES = [
  { intent: "running_shoe", label: "跑步鞋", productType: "shoes", aliases: ["跑步鞋", "公路跑鞋", "跑鞋", "running shoe", "running shoes"] },
  { intent: "trail_running_shoe", label: "越野跑鞋", productType: "shoes", aliases: ["越野跑鞋", "越野鞋", "trail shoe", "trail running"] },
  { intent: "training_shoe", label: "训练鞋", productType: "shoes", aliases: ["训练鞋", "训练用鞋", "training shoe"] },
  { intent: "basketball_shoe", label: "篮球鞋", productType: "shoes", aliases: ["篮球鞋", "篮球运动鞋", "basketball shoe"] },
  { intent: "football_shoe", label: "足球鞋", productType: "shoes", aliases: ["足球鞋", "足球运动鞋", "football shoe"] },
  { intent: "sports_shoe", label: "运动鞋", productType: "shoes", aliases: ["运动鞋", "休闲运动鞋", "运动休闲鞋", "sport shoe", "sneaker"] },
  { intent: "slipper", label: "拖鞋", productType: "shoes", aliases: ["拖鞋", "室内拖鞋", "浴室拖鞋", "slipper"] },
  { intent: "sandal", label: "凉鞋", productType: "shoes", aliases: ["凉鞋", "沙滩鞋", "溯溪鞋", "sandal"] },
  { intent: "boots", label: "靴子", productType: "shoes", aliases: ["靴子", "雪地靴", "短靴", "长靴", "boots"] },
  { intent: "formal_shoe", label: "正装鞋", productType: "shoes", aliases: ["皮鞋", "正装鞋", "乐福鞋", "loafer"] },
  { intent: "earphones", label: "耳机", productType: "audio", aliases: ["耳机", "耳塞", "buds", "headphone", "earphone"] },
  { intent: "speakers", label: "音箱", productType: "audio", aliases: ["音箱", "音响", "speaker", "soundbar"] },
  { intent: "coffee_pot", label: "咖啡壶", productType: "tableware", aliases: ["咖啡壶", "手冲壶", "滤壶"] },
  { intent: "coffee_machine", label: "咖啡机", productType: "kitchen_appliance", aliases: ["咖啡机", "coffee machine"] },
  { intent: "bed_frame", label: "床架", productType: "bed", aliases: ["床架", "bed frame"] },
  { intent: "mattress", label: "床垫", productType: "bed", aliases: ["床垫", "mattress"] },
  { intent: "storage_cabinet", label: "收纳柜", productType: "storage", aliases: ["收纳柜", "储物柜", "鞋柜", "衣柜", "cabinet"] },
  { intent: "office_chair", label: "办公椅", productType: "chair", aliases: ["办公椅", "电脑椅", "office chair"] },
  { intent: "coffee", label: "咖啡", productType: "food", aliases: ["咖啡", "咖啡豆", "coffee"] },
  { intent: "baby_sleeping_bag", label: "婴儿睡袋", productType: "baby_product", aliases: ["睡袋", "婴儿睡袋", "sleep sack"] },
  { intent: "floor_lamp", label: "落地灯", productType: "lamp", aliases: ["落地灯", "floor lamp"] },
];

type BrandAlias = {
  brand: string;
  aliases: string[];
  matchBrands?: string[];
};

// These are the brands present in the real catalog. Keep aliases broad enough
// for user language while matching the exact brand values stored in D1.
const BRAND_ALIASES: BrandAlias[] = [
  { brand: "Adidas", aliases: ["adidas", "阿迪达斯"] },
  { brand: "Nike", aliases: ["nike", "耐克"] },
  { brand: "Lululemon", aliases: ["lululemon", "露露乐蒙", "露露乐梦", "露露乐"] },
  { brand: "Uniqlo", aliases: ["uniqlo", "优衣库"] },
  { brand: "MUJI", aliases: ["muji", "无印良品", "无印"] },
  { brand: "IKEA", aliases: ["ikea", "宜家"] },
  { brand: "Xiaomi", aliases: ["xiaomi", "小米", "米家", "redmi", "红米"] },
  { brand: "Samsung", aliases: ["samsung", "三星"], matchBrands: ["Samsung", "Samsung US"] },
  { brand: "Apple", aliases: ["apple", "苹果"] },
  { brand: "QuanU 全友", aliases: ["quanu", "全友"] },
  { brand: "The North Face", aliases: ["the north face", "tnf", "北面"] },
  { brand: "Gree 格力", aliases: ["gree", "格力"], matchBrands: ["Gree 格力", "Gree"] },
  { brand: "Bosch", aliases: ["bosch", "博世"] },
  { brand: "Panasonic", aliases: ["panasonic", "松下"] },
  { brand: "GE Appliances", aliases: ["ge appliances", "ge", "通用电气"] },
  { brand: "LG", aliases: ["lg", "乐金"] },
  { brand: "Thuma", aliases: ["thuma"] },
  { brand: "AUX", aliases: ["aux", "奥克斯"] },
  { brand: "Breville", aliases: ["breville", "铂富"] },
];

const DEPARTMENT_ALIASES: Array<{ department: Department; aliases: string[] }> = [
  { department: "apparel", aliases: ["服饰", "服装", "衣服", "衣物", "穿搭", "运动服", "运动服饰", "运动装", "户外服", "户外服饰", "健身服", "瑜伽服", "训练服"] },
  { department: "digital", aliases: ["数码", "数码产品", "电子产品", "3c", "手机数码", "智能设备"] },
  { department: "appliance", aliases: ["电器", "家电", "家用电器", "厨房电器", "清洁电器", "个人护理电器"] },
  { department: "furniture", aliases: ["家具", "家装家具", "家居家具", "办公家具"] },
  { department: "home_goods", aliases: ["家居用品", "家居", "餐厨用品", "餐厨", "床品", "家居装饰", "收纳用品"] },
  { department: "personal_care", aliases: ["个护", "个护美妆", "个人护理", "美妆", "洗护", "护肤品"] },
  { department: "food", aliases: ["食品", "食品饮料", "零食", "饮料", "茶饮", "咖啡豆", "咖啡"] },
  { department: "pet", aliases: ["宠物用品", "宠物食品", "宠物", "猫粮", "狗粮"] },
  { department: "baby", aliases: ["母婴用品", "母婴", "婴儿用品", "婴童用品", "宝宝用品"] },
  { department: "stationery", aliases: ["文具办公", "办公用品", "文具", "办公"] },
  { department: "lighting", aliases: ["照明灯具", "照明", "灯具", "灯光"] },
  { department: "toys", aliases: ["玩具", "儿童玩具", "益智玩具"] },
  { department: "fitness", aliases: ["运动健身", "健身器材", "运动器材", "健身设备", "有氧运动", "有氧", "健身"] },
];

export function detectRequestProfile(message: string): RequestProfile {
  const text = normalizeText(message);
  const typeMatch = PRODUCT_TYPE_ALIASES
    .flatMap((entry) => entry.aliases.map((alias) => ({
      entry,
      alias: normalizeText(alias),
      index: text.indexOf(normalizeText(alias)),
    })))
    .filter(({ alias }) => alias && text.includes(alias))
    .sort((left, right) => right.alias.length - left.alias.length || left.index - right.index)[0]?.entry;
  const brandMatch = BRAND_ALIASES.find((entry) => entry.aliases.some((alias) => text.includes(normalizeText(alias))));
  const department = typeMatch?.department ?? detectDepartment(text);
  const productType = typeMatch?.type
    ?? (department === "fitness" && /有氧|动感单车|跑步机|健身器材|运动器材|健身设备/.test(text)
      ? "exercise_equipment"
      : null);
  const budget = extractBudget(message);

  return {
    department,
    productType,
    specificIntent: detectSpecificIntent(text, productType),
    brand: brandMatch?.brand ?? null,
    gender: detectGender(text),
    budget,
    size: extractSize(text, department, budget),
    screenSizeInch: extractNumber(text, /([0-9]+(?:\.[0-9]+)?)寸/),
    storageGb: extractStorage(text),
  };
}

export function getProductTypeLabel(productType: string | null) {
  if (!productType) return "这个品类";
  if (productType === "food") return "食品饮料";
  const match = PRODUCT_TYPE_ALIASES.find((entry) => entry.type === productType);
  return match?.aliases[0] ?? productType;
}

export function getSearchTerms(profile: RequestProfile) {
  const terms = new Set<string>();
  if (profile.department) terms.add(DEPARTMENT_LABELS[profile.department]);
  if (profile.productType) {
    const match = PRODUCT_TYPE_ALIASES.find((entry) => entry.type === profile.productType);
    for (const alias of match?.aliases ?? []) terms.add(alias);
  }
  if (profile.brand) {
    const match = BRAND_ALIASES.find((entry) => entry.brand === profile.brand);
    for (const alias of [...(match?.aliases ?? []), ...(match?.matchBrands ?? [])]) terms.add(alias);
  }
  if (profile.gender) terms.add(profile.gender);
  if (profile.specificIntent) {
    const intent = SPECIFIC_INTENT_ALIASES.find((entry) => entry.intent === profile.specificIntent);
    for (const alias of intent?.aliases ?? []) terms.add(alias);
  }
  return [...terms];
}

export function getSpecificIntentLabel(intent: string | null) {
  return SPECIFIC_INTENT_ALIASES.find((entry) => entry.intent === intent)?.label ?? null;
}

export function getSpecificIntentTerms(intent: string | null) {
  return SPECIFIC_INTENT_ALIASES.find((entry) => entry.intent === intent)?.aliases ?? [];
}

export function brandMatches(productBrand: string, requestedBrand: string) {
  const requested = BRAND_ALIASES.find((entry) => entry.brand === requestedBrand);
  if (!requested) return normalizeText(productBrand) === normalizeText(requestedBrand);

  return [requested.brand, ...(requested.matchBrands ?? [])].some(
    (brand) => normalizeText(productBrand) === normalizeText(brand),
  );
}

export function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function detectDepartment(text: string): Department | null {
  const match = DEPARTMENT_ALIASES
    .flatMap((entry) => entry.aliases.map((alias) => ({ department: entry.department, alias: normalizeText(alias) })))
    .filter(({ alias }) => alias && text.includes(alias))
    .sort((left, right) => right.alias.length - left.alias.length)[0];

  return match?.department ?? null;
}

function detectSpecificIntent(text: string, productType: string | null) {
  if (!productType) return null;

  return SPECIFIC_INTENT_ALIASES
    .filter((entry) => entry.productType === productType)
    .flatMap((entry) => entry.aliases.map((alias) => ({ intent: entry.intent, alias: normalizeText(alias) })))
    .filter(({ alias }) => alias && text.includes(alias))
    .sort((left, right) => right.alias.length - left.alias.length)[0]?.intent ?? null;
}

function detectGender(text: string): Gender | null {
  if (/儿童|孩子|宝宝|婴儿|幼儿|男童|女童|童装/.test(text)) return "child";
  if (/中性|男女|unisex/.test(text)) return "unisex";
  if (/女士|女生|女子|女款|女式|女性|女装|women/.test(text)) return "female";
  if (/男士|男生|男子|男款|男式|男性|男装|men/.test(text)) return "male";
  return null;
}

export function extractBudget(message: string) {
  const normalized = message.replace(/[,，]/g, "");
  const amountPattern = "(\\d{2,6}(?:\\.\\d+)?)";
  const contextualMatches = [
    ...normalized.matchAll(
      new RegExp(
        `(?:预算|价格|价位|不超过|不高于|最多|控制在|花费|花销|准备花|别超过|不超)\\s*[:：]?\\s*(?:(?:是|为|在|大约|大概|约|最多|不超过)\\s*)*${amountPattern}` +
          `\\s*(?:元|块|人民币|rmb|cny)?`,
        "gi",
      ),
    ),
  ];
  const suffixedMatches = [
    ...normalized.matchAll(new RegExp(`${amountPattern}\\s*(?:元|块|人民币|rmb|cny|以内|以下|左右|上下)`, "gi")),
  ];
  const conversationalMatches = [
    ...normalized.matchAll(new RegExp(`(?:如果|要是|提高到|加到|改到)\\s*${amountPattern}\\s*(?:元|块|人民币|rmb|cny)?\\s*(?:能买|也可以|可以|够|行|左右|上下)?`, "gi")),
  ];
  const explicit = [
    ...contextualMatches.map((match) => ({ value: Number(match[1]), index: match.index ?? 0 })),
    ...suffixedMatches.map((match) => ({ value: Number(match[1]), index: match.index ?? 0 })),
    ...conversationalMatches.map((match) => ({ value: Number(match[1]), index: match.index ?? 0 })),
    ...extractChineseBudgetMatches(normalized),
  ]
    .filter(({ value }) => Number.isFinite(value))
    .sort((left, right) => left.index - right.index);

  if (explicit.length) return explicit.at(-1)?.value ?? null;

  const segments = normalized.split(/[；;。!?！？]/).map((segment) => segment.trim()).filter(Boolean);
  const last = segments.at(-1) ?? "";
  return /^\d{2,6}(?:\.\d+)?$/.test(last) ? Number(last) : null;
}

function extractChineseBudgetMatches(text: string) {
  const amountPattern = "([零〇一二两三四五六七八九十百千万]+)";
  const contextual = [
    ...text.matchAll(new RegExp(
      `(?:预算|价格|价位|不超过|不高于|最多|控制在|花费|花销|准备花|别超过|不超)\\s*[:：]?\\s*${amountPattern}\\s*(?:元|块|人民币|rmb|cny|以内|以下|左右|上下)?`,
      "gi",
    )),
  ];
  const suffixed = [
    ...text.matchAll(new RegExp(`${amountPattern}\\s*(?:元|块|人民币|rmb|cny|以内|以下|左右|上下)`, "gi")),
  ];

  return [...contextual, ...suffixed]
    .map((match) => ({ value: parseChineseAmount(match[1]), index: match.index ?? 0 }))
    .filter(({ value }) => value !== null);
}

function parseChineseAmount(value: string) {
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

  if (!value || [...value].some((char) => digits[char] === undefined && units[char] === undefined)) return null;

  const trailingHundred = value.match(/^([零〇一二两三四五六七八九])千([零〇一二两三四五六七八九])$/);
  if (trailingHundred) return digits[trailingHundred[1]] * 1000 + digits[trailingHundred[2]] * 100;

  const trailingTen = value.match(/^([零〇一二两三四五六七八九])百([零〇一二两三四五六七八九])$/);
  if (trailingTen) return digits[trailingTen[1]] * 100 + digits[trailingTen[2]] * 10;

  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of value) {
    if (digits[char] !== undefined) {
      number = digits[char];
      continue;
    }

    const unit = units[char];
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * unit;
      number = 0;
    }
  }

  return total + section + number;
}

function extractSize(text: string, department: Department | null, budget: number | null) {
  const explicit = text.match(/(?:尺码|码数|size)[:：]?\s*(xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|\d{2,3}(?:cm|厘米)?)/i);
  if (explicit) return explicit[1].toUpperCase();

  if (department !== "apparel") return null;

  const standalone = text.match(/(?:^|[^a-z0-9])(xxxs|xxs|xs|m|l|xl|xxl|xxxl|\d{2,3}(?:cm|厘米)?)(?=$|[^a-z0-9])/i);
  if (!standalone) return null;

  const value = standalone[1];
  if (budget !== null && Number(value) === budget) return null;
  if (/^\d+$/.test(value) && isBudgetAmount(text, value)) return null;

  return value.toUpperCase();
}

function isBudgetAmount(text: string, value: string) {
  const amountPattern = `(?:${value})(?:元|块|人民币|rmb|cny|以内|以下|左右|上下)?`;
  return new RegExp(
    `(?:预算|价格|价位|不超过|不高于|最多|控制在|花费|花销|准备花)\\s*[:：]?\\s*(?:(?:是|为|在|大约|大概|约|最多|不超过)\\s*)*${amountPattern}`,
    "i",
  ).test(text);
}

function extractStorage(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(tb|gb|g)\b/i);
  if (!match) return null;
  return match[2].toLowerCase() === "tb" ? Number(match[1]) * 1024 : Number(match[1]);
}

function extractNumber(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}
