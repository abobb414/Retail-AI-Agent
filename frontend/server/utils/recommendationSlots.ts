import type { ProductFamily, SlotRequirement } from './catalogTypes'
import { getDominantIntent, getRequestedProductFamily } from './catalogIntents'

function hasBudgetSignal(text: string) {
  return /预算|价格|价位|\d{2,6}\s*(元|块|以内|以下|左右|上下)|低预算|中预算|高预算|便宜|平价|贵一点|不差钱/.test(text)
}

function hasWearerSignal(text: string) {
  return /男的|我是男|男士|男式|男子|男款|男生|男性|女的|我是女|女士|女式|女子|女款|女生|女性|中性|情侣|儿童|孩子|童|幼儿|大童|小童|婴童|宝宝|men|mens|man|women|womens|woman|unisex|尺码|码数|s码|m码|l码|xl|xxl|大码|小个子|高个子/.test(text)
}

function hasFurnitureContextSignal(text: string) {
  return /卧室|书房|客厅|餐厅|玄关|厨房|办公室|办公|工作|久坐|电脑|显示器|小户型|租房|儿童房|床头|阳台|收纳|整理|置物|几口人|几个人|单人|双人|尺寸|宽|高|深|cm|厘米|平米|㎡|风格|原木|实木|橡木|日式|北欧|日常|通勤|家用|随手|便携|单手/.test(text)
}

function hasApplianceContextSignal(text: string) {
  return /面积|平米|㎡|几口人|容量|升|l\b|匹|安装|预留|嵌入|台式|独立式|能效|一级|二级|变频|制冷|制热|除湿|洗烘|烘干|游戏|观影|客厅|卧室|厨房|面包机|吐司|烤箱|微波炉|咖啡机|洗碗机|电饭煲|热水壶|搅拌机|榨汁机|空气炸锅/.test(text)
}

function hasLightingContextSignal(text: string) {
  return /床头|书桌|桌面|阅读|学习|卧室|客厅|餐厅|玄关|氛围|夜灯|护眼|调光|色温|亮度|落地|台式|吊灯|暖光|冷光|柔光|工作|书房/.test(text)
}

function hasUserDeclinedMoreInfo(text: string) {
  return /不需要|不用了|不用问|直接推荐|就这样|你就直接|别问了|差不多得了|随便|你看着推|够了直接|可以了直接|别再问|不要问/.test(text)
}

const RE_STRONG_CONTEXT = /桌面|一团糟|收纳|整理|理一下|新工作|加班|好累|疲惫|治愈|幸福感|卧室|书房|客厅|餐厅|玄关|厨房|办公室|办公|工作|久坐|睡前|放松|浅木|原木|实木|橡木|白橡木|预算|小户型|日式|电脑|显示器|床头|氛围|早餐|通勤|阅读|学习|运动|训练|跑步|瑜伽|户外|登山|露营|空调|冰箱|洗衣|电视|烤箱|微波|品牌|adidas|阿迪达斯|nike|耐克|lululemon|露露乐蒙|uniqlo|优衣库|muji|无印良品|ikea|宜家|三星|小米|米家|海尔|格力|tcl|lg|bosch|博世|panasonic|松下|男|女|儿童|夏天|冬天|透气|宽松|修身|纯棉|速干|防晒|大码|小个子|高个子|[0-9]+元|跑鞋|运动鞋|板鞋|跑步鞋|香薰机|polo|沙发床|吸尘器|洗碗机|化妆包|挂衣架|拖鞋|手机壳|蜡烛|枕头|七分袖|背心|针织|卫衣|羽绒|内衣|裙|衬衫|柜|餐具|水壶|风扇|手表|耳机|刀|锅|牙刷|清洁|收纳箱|沙发|书桌|桌子|椅子|凳子|碗|马克杯|镜子|书架|鞋柜|衣柜|电视柜|收纳架|床架|双人床|餐桌|面包机|冲锋衣/

function hasStrongRecommendationContext(text: string) {
  return RE_STRONG_CONTEXT.test(text)
}

const slotRequirementsByFamily: Record<ProductFamily, SlotRequirement[]> = {
  apparel: [
    {
      id: 'wearer',
      label: '男士/女士/中性或尺码',
      isSatisfied: hasWearerSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  furniture: [
    {
      id: 'space_use_or_size',
      label: '使用空间、用途或尺寸',
      isSatisfied: hasFurnitureContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  appliance: [
    {
      id: 'install_capacity_or_scene',
      label: '安装条件、容量/面积或使用场景',
      isSatisfied: hasApplianceContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  lighting: [
    {
      id: 'location_or_lighting_need',
      label: '使用位置或照明需求',
      isSatisfied: hasLightingContextSignal,
    },
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  tableware: [
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
  misc: [
    {
      id: 'budget',
      label: '预算',
      isSatisfied: hasBudgetSignal,
    },
  ],
}

function hasStrongProductSignal(text: string) {
  // Brand name specified = enough context to skip budget
  return /格力|海尔|美的|小米|三星|lg|bosch|博世|松下|panasonic|宜家|ikea|muji|无印|uniqlo|优衣库|nike|耐克|adidas|阿迪|lululemon|北面|the north face|xiaomi|redmi|ge|quanu|全友|thuma/.test(text)
}

function getMissingSlotRequirements(text: string) {
  const family = getRequestedProductFamily(text)
  if (!family) {
    return []
  }

  // If user specified a brand, skip all clarification slots
  if (hasStrongProductSignal(text)) {
    return []
  }

  return slotRequirementsByFamily[family].filter((requirement) => !requirement.isSatisfied(text))
}

function getClarificationPrefix(family: ProductFamily) {
  if (family === 'apparel') {
    return '可以，我先不急着硬推。'
  }
  if (family === 'furniture') {
    return '可以，我先把方向收窄一下。'
  }
  if (family === 'appliance') {
    return '可以，家电先把关键条件确认好。'
  }
  if (family === 'tableware') {
    return '可以，餐具这块我先把预算确认一下。'
  }
  if (family === 'misc') {
    return '可以，我先确认一下预算。'
  }
  return '可以，灯具先看使用位置和预算。'
}

function getSlotQuestion(family: ProductFamily, missingRequirements: SlotRequirement[]) {
  const missingLabels = missingRequirements.map((requirement) => requirement.label)
  if (missingLabels.length === 1) {
    return `${getClarificationPrefix(family)}还差一个信息：${missingLabels[0]}？`
  }

  return `${getClarificationPrefix(family)}还差这几个关键信息：${missingLabels.join('、')}？`
}

export function getRecommendationClarificationMessage(text: string) {
  const family = getRequestedProductFamily(text)
  if (!family) {
    return null
  }

  const missingRequirements = getMissingSlotRequirements(text)
  return missingRequirements.length ? getSlotQuestion(family, missingRequirements) : null
}

export function shouldClarifyBeforeRecommendation(text: string) {
  if (hasUserDeclinedMoreInfo(text)) {
    return false
  }

  if (hasStrongRecommendationContext(text)) {
    return false
  }

  // Multi-turn context (contains "；"): the user is responding to a clarification question.
  // If the latest part is a short contextual response (no intent, no budget), skip clarification
  // and let pickProductRecommendation handle it with the full context.
  if (text.includes('；')) {
    const latestPart = text.slice(text.lastIndexOf('；') + 1).trim()
    if (latestPart.length <= 8 && !getDominantIntent(latestPart) && !hasBudgetSignal(latestPart)) {
      return false
    }
  }

  if (getRecommendationClarificationMessage(text)) {
    return true
  }

  const compactText = text.replace(/\s+/g, '')
  return /^(我)?(想要|需要|要|想买|买|推荐|给我推荐|给我|找|选)?(一个|一把|一张|一件|一双|一台|一套|一张|一款|个|把|张|件|双|台|套|款)?(椅子|座椅|凳子|桌子|书桌|办公桌|台灯|灯|香薰机|香薰|收纳盒|衣服|半袖|短袖|t恤|鞋|鞋子|裤子|外套|背心|空调|冰箱|洗衣机|电视|沙发|床|柜子)$/.test(compactText)
}

export function wantsProductRecommendation(text: string) {
  return /推荐|产品|商品|具体|买|购入|单品|给我一个|给我推荐|直接|想要|需要|适合|找|选|搭配|官网|型号|改变|治愈|疲惫|好累|幸福感|一团糟|整理|收纳|理一下|新工作|加班|运动|训练|跑步|瑜伽|户外|登山|露营|通勤|穿|鞋|衣服|半袖|短袖|t恤|冲锋衣|硬壳|防风|防雨|防水|外套|夹克|裤|家电|空调|冰箱|洗衣|电视|家具|沙发|床|桌|椅|手机壳|灯|拖鞋|polo|吸尘器|洗碗机|化妆包|挂衣架|枕头|蜡烛|背心|针织|卫衣|羽绒|防晒|内衣|裙|衬衫|柜|餐具|咖啡机|水壶|烤箱|微波炉|显示器|手机|手表|耳机|风扇|刀|锅|牙刷|剃须|清洁|平板|书架|鞋柜|衣柜|电视柜|收纳架|凳|碗|镜子|床架|香薰|预算|价格|冲锋衣|面包机|台灯|咖啡机|一双|换个|换一个|换一件|换|灯光|光线|氛围|暖光|冷光|柔光|舒服|舒适|好看|颜值|质感|品质|好用|耐用/.test(text)
}
