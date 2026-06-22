import type { CatalogProduct, ProductFamily, ProductIntent } from './catalogTypes'
import { normalizeText } from './catalogText'

export const productIntents: ProductIntent[] = [
  // ── 户外/防雨外套 ──
  {
    id: 'weather_outerwear',
    userPattern: /冲锋衣|硬壳|gore|gore-tex|gtx|登山|户外外套|防风外套|防水外套|防风防雨|防风|防雨|防水|雨衣/,
    productPattern: /冲锋衣|硬壳|gore|gore tex|gtx|storm fit|户外.*(夹克|外套)|登山.*(夹克|外套)|防风.*(夹克|外套)|防水.*(夹克|外套)|拒水.*(夹克|外套)|夹克|外套|jacket|coat|雨衣|风衣|大衣|trench/,
    requireProductPattern: /冲锋衣|硬壳|gore|gore tex|gtx|storm fit|防风|防水|拒水|雨衣|风衣|大衣|trench|夹克|外套|jacket|coat/,
    excludeProductPattern: /家具|沙发|床|椅|凳|豆袋|宠物|狗狗|猫咪/,
    promptTerms: ['冲锋衣', '硬壳', '防风', '防雨', '防水', '拒水', '户外外套', '登山外套', '雨衣', '城市通勤防雨'],
  },

  // ── T恤/短袖 ──
  {
    id: 'tee',
    userPattern: /半袖|短袖|t恤|tee|t-shirt|polo|翻领.*衫|圆领.*衫|v领.*衫|夏天.*通勤|通勤.*半袖/,
    productPattern: /半袖|短袖|t恤|tee|t shirt|t-shirt|shirt|上衣|背心|马甲|无袖|tank|vest|polo/,
    excludeProductPattern: /长袖|夹克|外套|裤子|长裤|短裤|运动裤|休闲裤|西裤|牛仔裤|帽|幼儿|婴童|儿童|童装|宠物|狗狗|猫咪|long sleeve|棉服|羽绒|大衣|风衣|睡衣|家居服|文胸|bra/,
    promptTerms: ['半袖', '短袖', 'T恤', '上衣', '背心', '马甲', 'Polo', '夏天通勤', '透气', '凉感', '休闲短袖'],
  },

  // ── 衬衫 ──
  {
    id: 'shirt',
    userPattern: /衬衫|衬衣|shirt|商务休闲/,
    productPattern: /衬衫|衬衣|罩衫|shirt|长袖.*上衣/,
    excludeProductPattern: /短袖|半袖|t恤|tee|夹克|外套|裤/,
    promptTerms: ['衬衫', '衬衣', '商务休闲', '通勤上衣', '长袖衬衫'],
  },

  // ── 裤装 ──
  {
    id: 'pants',
    userPattern: /裤子|长裤|短裤|运动裤|休闲裤|pants|trouser|西裤|工装裤|打底裤|leggings|紧身裤|阔腿裤|直筒裤|九分裤|七分裤/,
    productPattern: /裤|pants|trouser|shorts|宽版裤|窄版裤|直筒裤|阔腿裤|牛仔裤|jeans|西裤|工装裤|打底裤|leggings|紧身裤|九分裤|七分裤/,
    excludeProductPattern: /上衣|短袖|t恤|夹克|外套|鞋/,
    promptTerms: ['裤子', '长裤', '短裤', '运动裤', '休闲裤', '通勤裤', '牛仔裤', '西裤', '工装裤', '打底裤'],
  },

  // ── 鞋 ──
  {
    id: 'shoes',
    userPattern: /鞋|鞋子|跑鞋|运动鞋|板鞋|登山鞋|徒步鞋|sneaker|shoe|高跟鞋|平底鞋|单鞋|皮鞋|帆布鞋|老爹鞋|凉鞋|拖鞋|靴|boot|sandal|slipper|乐福鞋|loafer|穆勒鞋|mule|德训鞋/,
    productPattern: /鞋|sneaker|shoe|footwear|靴|boot|拖鞋|slipper|凉鞋|sandal|高跟|平底|单鞋|皮鞋|帆布|老爹鞋|乐福|loafer|穆勒|mule|德训/,
    promptTerms: ['鞋', '运动鞋', '跑鞋', '板鞋', '徒步鞋', '通勤鞋', '靴子', '拖鞋', '凉鞋', '皮鞋', '高跟鞋', '帆布鞋'],
  },

  // ── 配件（帽子/包/手套） ──
  {
    id: 'accessory',
    userPattern: /帽|帽子|包|背包|手套|配件|cap|hat|bag/,
    productPattern: /帽|包|背包|手套|配件|口罩|cap|hat|bag|accessor|钱包|卡包|行李箱|旅行箱|wallet|luggage|suitcase|mask/,
    promptTerms: ['帽子', '背包', '手套', '配件', '户外配件', '运动配件', '钱包', '行李箱'],
  },

  // ── 灯具 ──
  {
    id: 'lighting',
    userPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light|吊灯|壁灯|吸顶灯|射灯|筒灯|灯带|夜灯|氛围灯|led灯/,
    productPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light|lantern|吊灯|壁灯|吸顶灯|射灯|筒灯|灯带|夜灯|氛围灯|led灯/,
    requireProductPattern: /灯|台灯|落地灯|灯泡|照明|lamp|light|lantern|吊灯|壁灯|吸顶灯|射灯|筒灯|灯带|夜灯|氛围灯|led灯/,
    excludeProductPattern: /服饰|鞋|裤|t恤|电视|显示器|手环|耳机|手机|平板|电脑/,
    promptTerms: ['台灯', '灯具', '照明', '灯泡', '阅读灯', '卧室灯', '落地灯', '吊灯', '氛围灯'],
  },

  // ── 办公椅 ──
  {
    id: 'office_chair',
    userPattern: /办公椅|工作椅|电脑椅|人体工学椅|久坐|office chair|desk chair|ergonomic chair/,
    productPattern: /办公椅|工作椅|电脑椅|转椅|人体工学|ergonomic|office chair|desk chair/,
    requireProductPattern: /办公椅|工作椅|电脑椅|转椅|人体工学|ergonomic|office chair|desk chair|椅/,
    excludeProductPattern: /儿童|幼儿|婴童|童|沙发|床|桌|餐椅|躺椅|贵妃椅|坐垫|靠垫|椅垫|垫|扶手|套件|配件|零件|accessor/,
    promptTerms: ['办公椅', '工作椅', '电脑椅', '人体工学椅', '久坐', '书房办公', '转椅'],
  },

  // ── 椅子/座椅 ──
  {
    id: 'seating',
    userPattern: /椅子|座椅|餐椅|休闲椅|凳子|chair|seating|扶手椅|单人椅|设计师椅/,
    productPattern: /椅|座椅|凳|chair|长凳|bench|扶手椅|单人椅/,
    excludeProductPattern: /服饰|短袖|t恤|鞋|家电|空调|冰箱|电视|沙发|床|儿童|幼儿|婴童|椅垫|坐垫|靠垫|垫套|凳套/,
    promptTerms: ['椅子', '座椅', '餐椅', '休闲椅', '客厅椅', '书房椅', '扶手椅'],
  },

  // ── 沙发/床/床垫 ──
  {
    id: 'sofa_bed',
    userPattern: /沙发|沙发床|床|床垫|sofa|bed|mattress/,
    productPattern: /沙发|床|床垫|sofa|bed|mattress|坐卧两用/,
    excludeProductPattern: /服饰|短袖|t恤|鞋|家电/,
    promptTerms: ['沙发', '沙发床', '床', '床垫', '卧室', '客厅', '小户型'],
  },

  // ── 桌子/书桌 ──
  {
    id: 'table_desk',
    userPattern: /桌|书桌|餐桌|办公桌|茶几|边桌|desk|table/,
    productPattern: /桌|茶几|desk|table|工作台|写字台/,
    excludeProductPattern: /服饰|家电/,
    promptTerms: ['桌子', '书桌', '办公桌', '餐桌', '茶几', '边桌'],
  },

  // ── 收纳/柜子 ──
  {
    id: 'storage',
    userPattern: /收纳|柜|衣柜|储物|整理|置物架|storage|cabinet|wardrobe/,
    productPattern: /收纳|柜|储物|置物|架|storage|cabinet|wardrobe|shelf|斗柜|书柜|鞋柜|餐柜|电视柜|床头柜|衣柜|衣架|hanger/,
    excludeProductPattern: /服饰|短袖|t恤/,
    promptTerms: ['收纳', '柜子', '衣柜', '储物', '置物架', '桌面整理', '鞋柜', '书柜'],
  },

  // ── 空调 ──
  {
    id: 'air_conditioner',
    userPattern: /空调|冷气|制冷|除湿|air conditioner|cooling/,
    productPattern: /空调|冷气|制冷|air conditioner|airconditioner|portable air conditioner|window air conditioner|风管|室内机|中央空调|cooling|heat.*cool/,
    requireProductPattern: /空调|air conditioner|airconditioner|风管|室内机|cooling/,
    excludeProductPattern: /服饰|家具|冰箱|冷藏|冷冻|风冷|直冷|refrigerator|fridge/,
    promptTerms: ['空调', '制冷', '除湿', '客厅空调', '卧室空调', '节能'],
  },

  // ── 冰箱 ──
  {
    id: 'refrigerator',
    userPattern: /冰箱|冷藏|冷冻|refrigerator|fridge/,
    productPattern: /冰箱|冷藏|冷冻|refrigerator|fridge/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['冰箱', '冷藏', '冷冻', '厨房家电', '容量'],
  },

  // ── 洗衣机/烘干机 ──
  {
    id: 'washer',
    userPattern: /洗衣机|烘干|洗烘|washer|dryer|laundry/,
    productPattern: /洗衣|烘干|洗烘|washer|dryer|laundry/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['洗衣机', '烘干机', '洗烘', '家用电器'],
  },

  // ── 电视/显示器 ──
  {
    id: 'tv_monitor',
    userPattern: /电视|显示器|屏幕|影院|游戏屏|monitor|tv/,
    productPattern: /电视|显示器|屏幕|monitor|tv|mini led|oled|智屏|巨幕|影院|投影|projector|display/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['电视', '显示器', '屏幕', '客厅影音', '游戏屏', 'Mini LED', '投影仪'],
  },

  // ── 厨房电器 ──
  {
    id: 'kitchen_appliance',
    userPattern: /洗碗机|烤箱|微波炉|厨电|厨房电器|dishwasher|oven|microwave/,
    productPattern: /洗碗机|烤箱|微波|厨电|dishwasher|oven|microwave|kitchen appliance|咖啡机|coffee|面包机|bread|多士炉|toaster|电饭煲|rice cooker|热水壶|kettle|搅拌机|blender|榨汁机|juicer|空气炸锅|air fryer|料理机|破壁机/,
    excludeProductPattern: /服饰|家具/,
    promptTerms: ['洗碗机', '烤箱', '微波炉', '厨房电器', '厨电', '咖啡机', '面包机', '电饭煲'],
  },

  // ── 护肤/美妆/个人护理 ──
  {
    id: 'cosmetics_skincare',
    userPattern: /面膜|护肤|精华|面霜|乳液|化妆|美妆|口红|眼影|腮红|粉底|防晒|洁面|洗面|爽肤水|卸妆|保湿|补水|身体乳|护手霜|洗发|护发|沐浴|洗手液|牙刷|牙膏|美甲|指甲油|香水|香氛|fragrance|perfume|nail|cosmetics|skincare|makeup|sunscreen|moisturizer|cleanser|shampoo|lotion/,
    productPattern: /面膜|精华|乳液|面霜|护肤|保湿|补水|控油|防晒|爽肤水|洁面|洗面|水乳|身体乳|护手霜|腮红|口红|眼影|粉底|遮瑕|卸妆|化妆|美妆|唇膏|唇釉|眼线|睫毛|洗发|护发|沐浴|洗手|湿巾|肥皂|牙刷|牙膏|美甲|指甲油|香水|香氛|护理油|角质|cosmetic|skincare|makeup|sunscreen|moisturizer|cleanser|shampoo|lotion|soap|toothbrush|lipstick|foundation|blush|fragrance|perfume|nail|wipe/,
    excludeProductPattern: /服饰|家具|家电|电视|电脑|手机/,
    promptTerms: ['面膜', '精华', '面霜', '防晒', '洗发水', '沐浴露', '身体乳', '牙刷', '护肤品', '化妆品', '香水', '美甲'],
  },

  // ── 床品/被褥 ──
  {
    id: 'bedding',
    userPattern: /被套|被子|床单|枕头|床品|四件套|枕套|床笠|被芯|毛毯|毯子|夏凉被|蚕丝被|羽绒被|bedding|pillow|blanket|duvet|comforter|凉席|竹席|蚊帐|床垫保护罩|mattress protector|褥子/,
    productPattern: /被套|被子|床单|枕头|床品|四件套|枕套|床笠|被芯|毛毯|毯子|夏凉被|蚕丝被|羽绒被|bedding|pillow|blanket|duvet|comforter|床罩|褥子|床裙|凉席|竹席|蚊帐|mattress protector/,
    excludeProductPattern: /服饰|家电|电视|电脑/,
    promptTerms: ['被套', '枕头', '床品', '四件套', '毛毯', '夏凉被', '蚕丝被', '凉席', '褥子'],
  },

  // ── 餐具/厨具 ──
  {
    id: 'kitchenware',
    userPattern: /碗|盘|杯子|筷子|勺子|叉子|刀具|砧板|锅|壶|餐垫|餐具|厨具|料理|烘焙|量杯|打蛋器|滤网|水杯|马克杯|保温杯|餐盘|饭碗|汤碗/,
    productPattern: /碗|盘|杯|筷子|勺|叉|刀|砧板|锅|壶|餐垫|餐具|厨具|料理|烘焙|量杯|打蛋器|滤网|水杯|马克杯|保温杯|餐盘|饭碗|汤碗|bowl|plate|cup|chopstick|spoon|fork|knife|cutting board|pot|pan|kettle|baking|cooking|kitchenware|tableware|dinnerware|容器|保存|保鲜|密封|便当|餐盒|收纳盒|调料|调味|漏勺|汤勺|锅铲|刮铲|滤网|筛网|厨房/,
    excludeProductPattern: /电视|电脑|手机|沙发|床/,
    promptTerms: ['碗', '盘', '杯子', '筷子', '餐具', '厨具', '烘焙', '水杯', '餐盘', '容器', '保鲜'],
  },

  // ── 笔记本/平板电脑 ──
  {
    id: 'laptop_tablet',
    userPattern: /笔记本|laptop|平板|tablet|pad|电脑|computer|book pro|redmibook/,
    productPattern: /笔记本|laptop|平板|tablet|pad|电脑|computer|book pro|redmibook|macbook|notebook|chromebook/,
    excludeProductPattern: /服饰|家具|家电|冰箱|空调|洗衣/,
    promptTerms: ['笔记本', '平板', '电脑', 'laptop', 'tablet', '办公电脑'],
  },

  // ── 小家电/智能家居 ──
  {
    id: 'smart_home',
    userPattern: /净化器|加湿器|除湿机|扫地机|吸尘器|风扇|取暖器|空气净化|空气循环|新风机|vacuum|humidifier|air purifier|fan|heater|新风|壁挂|落地扇|台扇|循环扇|电暖|暖风机|冷风扇|空气清新/,
    productPattern: /净化器|加湿器|除湿机|扫地机|吸尘器|风扇|取暖器|空气净化|空气循环|新风机|vacuum|humidifier|air purifier|fan|heater|空气净化器|落地扇|台扇|循环扇|除湿器|新风|电暖|暖风机|冷风扇|空气清新/,
    excludeProductPattern: /服饰|家具|冰箱|空调|洗衣|电视/,
    promptTerms: ['净化器', '加湿器', '扫地机', '吸尘器', '风扇', '空气净化', '新风机', '除湿机'],
  },

  // ── 连衣裙/半身裙 ──
  {
    id: 'dress',
    userPattern: /连衣裙|半身裙|裙子|dress|skirt|裙装|礼服|晚装|小黑裙|迷你裙|蓬蓬裙|鱼尾裙/,
    productPattern: /连衣裙|半身裙|裙子|裙|dress|skirt|裙装|短裙|长裙|a字裙|百褶裙|衬衫裙|吊带裙|礼服|晚装|小黑裙|迷你裙|蓬蓬裙|鱼尾裙|抽褶|蓬蓬/,
    excludeProductPattern: /家具|家电|电视|电脑/,
    promptTerms: ['连衣裙', '半身裙', '裙子', '裙装', '夏裙', '通勤裙', '礼服', '小黑裙'],
  },

  // ── 内衣/内裤/睡衣 ──
  {
    id: 'underwear',
    userPattern: /内衣|内裤|文胸|胸罩|bra|背心|吊带|保暖衣|秋衣|秋裤|睡衣|家居服|浴袍|underwear|pajama|loungewear|robe/,
    productPattern: /内衣|内裤|文胸|胸罩|bra|背心|吊带|保暖衣|秋衣|秋裤|睡衣|家居服|浴袍|underwear|pajama|loungewear|robe|内搭|打底|thermal|base layer/,
    excludeProductPattern: /家具|家电|电视|电脑|宠物|狗狗|猫咪/,
    promptTerms: ['内衣', '内裤', '睡衣', '家居服', '保暖衣', '打底', '文胸'],
  },

  // ── 袜子 ──
  {
    id: 'socks',
    userPattern: /袜子|短袜|长袜|中筒袜|船袜|运动袜|socks?/,
    productPattern: /袜|sock|短袜|长袜|中筒袜|船袜|运动袜/,
    excludeProductPattern: /家具|家电|电视|电脑/,
    promptTerms: ['袜子', '短袜', '运动袜', '船袜', '中筒袜'],
  },

  // ── 毛衣/针织衫 ──
  {
    id: 'knitwear',
    userPattern: /毛衣|针织|sweater|knit|毛衫|开衫|卫衣|hoodie|卫裤|运动套装|抓绒|摇粒绒|fleece|马海毛|mohair|羊驼|alpaca/,
    productPattern: /毛衣|针织|sweater|knit|毛衫|开衫|卫衣|hoodie|卫裤|运动套装|绒|fleece|羊毛|wool|cashmere|羊绒|抓绒|摇粒绒|马海毛|mohair|羊驼|alpaca/,
    excludeProductPattern: /家具|家电|电视|电脑/,
    promptTerms: ['毛衣', '针织衫', '卫衣', '开衫', '羊毛', '羊绒', '抓绒', '摇粒绒'],
  },

  // ── 棉服/羽绒服 ──
  {
    id: 'outerwear_cold',
    userPattern: /棉服|羽绒|羽绒服|down|棉衣|保暖外套|棉袄|羽绒背心|派克|parka|极寒|鹅绒|鸭绒/,
    productPattern: /棉服|羽绒|羽绒服|down|棉衣|保暖外套|棉袄|羽绒背心|padded|quilted|puffer|派克|parka|鹅绒|鸭绒/,
    excludeProductPattern: /家具|家电|电视|电脑|宠物|狗狗|猫咪/,
    promptTerms: ['棉服', '羽绒服', '保暖外套', '羽绒背心', '冬季外套', '派克大衣', '鹅绒'],
  },

  // ── 音箱/耳机/音频 ──
  {
    id: 'audio',
    userPattern: /音箱|speaker|耳机|earphone|headphone|蓝牙|bluetooth|音响|soundbar|音频|降噪|anc|tws|头戴式|入耳式|挂耳式|骨传导|低音炮|subwoofer|回音壁/,
    productPattern: /音箱|speaker|耳机|earphone|headphone|蓝牙|bluetooth|音响|soundbar|音频|audio|sound|buds|earbuds|降噪|anc|tws|头戴|入耳|挂耳|骨传导|低音炮|subwoofer|回音壁/,
    excludeProductPattern: /服饰|家具|家电|冰箱|空调|洗衣/,
    promptTerms: ['音箱', '耳机', '蓝牙音箱', '音响', '音频', '降噪耳机', '蓝牙耳机', '回音壁'],
  },

  // ── 家居装饰/香薰 ──
  {
    id: 'home_decor',
    userPattern: /蜡烛|香薰|扩香|香氛|挂画|装饰|花瓶|摆件|地毯|窗帘|靠垫|坐垫|垫子|candle|fragrance|diffuser|vase|rug|carpet|curtain|cushion|poster|frame|mirror|镜子|收纳盒|托盘|花盆|衣架|相框|钟表|时钟|挂钟|桌布|餐巾/,
    productPattern: /蜡烛|香薰|扩香|香氛|挂画|装饰|花瓶|摆件|地毯|窗帘|靠垫|坐垫|垫子|candle|fragrance|diffuser|vase|rug|carpet|curtain|cushion|poster|frame|mirror|镜子|相框|装饰画|地垫|脚垫|门垫|收纳盒|托盘|花盆|衣架|钟表|时钟|挂钟|桌布|餐巾/,
    excludeProductPattern: /服饰|家电|电视|电脑|手机/,
    promptTerms: ['蜡烛', '香薰', '地毯', '窗帘', '靠垫', '装饰', '花瓶', '镜子', '收纳盒', '花盆'],
  },

  // ── 食品/零食/饮料 ──
  {
    id: 'food_snacks',
    userPattern: /零食|食品|茶|咖啡|巧克力|饼干|糖果|坚果|果汁|饮料|调味|酱|蜂蜜|snack|food|tea|coffee|chocolate|cookie|candy|nut|juice|drink|sauce|honey/,
    productPattern: /零食|食品|茶|咖啡|巧克力|饼干|糖果|坚果|果汁|饮料|调味|酱|蜂蜜|snack|food|tea|coffee|chocolate|cookie|candy|nut|juice|drink|sauce|honey|茶包|茶壶|茶杯|茶具|冲泡|速溶|即溶|脆脆面|海苔|猪肉脯|肉脯|肉干|肉松|柿种|米果|脆片|卷饼|锅巴|膨化|曲奇|威化|果冻|布丁|蛋糕|面包|吐司|麦片|谷物|果干|蜜饯|果脯|果酱|花生酱|芝麻酱|糖浆|调味料|调料|酱料|醋|酱油|蚝油|料酒|味精|鸡精|盐|胡椒|辣椒|花椒|八角|桂皮|香叶|咖喱|芥末|番茄酱|沙拉酱|蛋黄酱|甜辣酱|辣酱|豆瓣酱|黄酱|腐乳|豆豉|泡菜|腌菜|酱菜|榨菜|酸菜|咸菜|海带|紫菜|裙带菜|木耳|银耳|香菇|茶树菇|猴头菇|松茸|牛肝菌|鸡枞菌|竹荪|虫草花|枸杞|红枣|桂圆|莲子|百合|燕窝|阿胶|人参|鹿茸|灵芝|石斛|三七|黄芪|当归/,
    excludeProductPattern: /服饰|家电|电视|电脑|家具|沙发|床|椅|桌|柜/,
    promptTerms: ['零食', '茶', '咖啡', '巧克力', '坚果', '果汁', '食品', '海苔', '肉脯', '脆片'],
  },

  // ── 通用家具（IKEA/QuanU等品牌通用匹配） ──
  {
    id: 'generic_furniture',
    userPattern: /家具|家居|furniture|home/,
    productPattern: /家具|家居|furniture|客厅|卧室|书房|餐厅|厨房|青少年房|茶室|实木|成品/,
    excludeProductPattern: /服饰|鞋|家电|空调|冰箱|电视|洗衣/,
    promptTerms: ['家具', '家居', '客厅家具', '卧室家具', '书房家具', '实木家具'],
  },

  // ── 运动服饰（通用匹配） ──
  {
    id: 'sportswear',
    userPattern: /运动|sport|training|训练|健身|gym|跑步|running|瑜伽|yoga|户外|outdoor|徒步|hiking|登山|climbing|游泳|swim|泳衣|swimsuit|泳裤|swim trunks/,
    productPattern: /运动|sport|training|训练|健身|gym|跑步|running|瑜伽|yoga|户外|outdoor|徒步|hiking|登山|climbing|游泳|swim|泳衣|swimsuit|泳裤|swim trunks|jersey|球衣|队服|比赛服|训练服|速干|透气|弹力|紧身|压缩|compression|套装/,
    excludeProductPattern: /家具|家电|电视|电脑|手机/,
    promptTerms: ['运动服', '训练服', '健身服', '跑步服', '瑜伽服', '户外服', '泳衣'],
  },

  // ── 手机配件/数码配件 ──
  {
    id: 'phone_accessory',
    userPattern: /手机壳|保护壳|表带|触控笔|stylus|pen|充电器|charger|数据线|cable|耳机|earphone|贴膜|screen protector|手机套|case|cover/,
    productPattern: /手机壳|保护壳|表带|触控笔|stylus|pen|充电器|charger|数据线|cable|贴膜|screen protector|手机套|case|cover|s pen|galaxy buds|airpods|watch band|strap/,
    excludeProductPattern: /家具|家电|冰箱|空调|洗衣/,
    promptTerms: ['手机壳', '保护壳', '表带', '触控笔', '充电器', '耳机'],
  },

  // ── 个人护理电器 ──
  {
    id: 'personal_care_appliance',
    userPattern: /剃须|刮胡|理发|推子|trimmer|clipper|shaver|电动牙刷|toothbrush|吹风机|hair dryer|卷发棒|straightener|美容仪|beauty device|洁面仪|美容器|按摩仪|筋膜枪|massager|洁牙器|冲牙器|water flosser|鼻毛器|nose trimmer|电推剪|电吹风/,
    productPattern: /剃须|刮胡|理发|推子|trimmer|clipper|shaver|电动牙刷|toothbrush|吹风机|hair dryer|卷发棒|straightener|美容仪|beauty device|须刀|刀头|刀片|foil|blade|洁面仪|美容器|按摩仪|筋膜枪|massager|洁牙器|冲牙器|water flosser|鼻毛器|nose trimmer|电推剪|电吹风/,
    excludeProductPattern: /家具|家电|电视|电脑|手机/,
    promptTerms: ['剃须刀', '理发器', '电动牙刷', '吹风机', '个人护理', '洁面仪', '美容仪', '筋膜枪', '冲牙器'],
  },

  // ── 清洁用品 ──
  {
    id: 'cleaning',
    userPattern: /清洁|clean|洗剂|洗涤|洗衣液|洗洁精|消毒|除菌|去污|清洁剂|清洁工具|拖把|mop|扫帚|broom|抹布|cloth|扫地|拖地|擦窗|除尘|除螨|duster|真空袋|收纳袋|衣物护理|柔顺剂|漂白|去渍|stain|lint|粘毛/,
    productPattern: /清洁|clean|洗剂|洗涤|洗衣液|洗洁精|消毒|除菌|去污|清洁剂|清洁工具|拖把|mop|扫帚|broom|抹布|cloth|机器清洁|washing machine cleaner|dishwasher cleaner|扫地|拖地|擦窗|除尘|除螨|duster|柔顺剂|漂白|去渍|stain|lint|粘毛|衣物护理/,
    excludeProductPattern: /服饰|家具|电视|电脑|手机/,
    promptTerms: ['清洁', '洗涤', '消毒', '除菌', '清洁剂', '洗衣液', '扫地', '拖地', '除螨', '去渍'],
  },

  // ── 婴幼儿用品 ──
  {
    id: 'baby_products',
    userPattern: /婴儿|婴童|幼儿|宝宝|baby|infant|toddler|新生儿|newborn|和尚服|连体衣|onesie|爬服|口水巾|围兜|bib/,
    productPattern: /婴儿|婴童|幼儿|宝宝|baby|infant|toddler|新生儿|newborn|和尚服|连体衣|onesie|爬服|口水巾|围兜|bib|童装|kids|儿童|children|大童|小童|男童|女童/,
    excludeProductPattern: /家具|家电|电视|电脑/,
    promptTerms: ['婴儿服', '幼儿服', '童装', '宝宝装', '新生儿'],
  },

  // ── 宠物用品 ──
  {
    id: 'pet_products',
    userPattern: /宠物|pet|狗狗|dog|猫咪|cat|宠物衣|宠物服|宠物用品/,
    productPattern: /宠物|pet|狗狗|dog|猫咪|cat|宠物衣|宠物服|宠物用品|pet clothing|pet accessories/,
    excludeProductPattern: /家具|家电|电视|电脑/,
    promptTerms: ['宠物', '狗狗', '猫咪', '宠物服', '宠物用品'],
  },
]

const intentFamilyMap: Record<string, ProductFamily> = {
  accessory: 'apparel',
  air_conditioner: 'appliance',
  audio: 'appliance',
  baby_products: 'apparel',
  bedding: 'furniture',
  cleaning: 'appliance',
  cosmetics_skincare: 'apparel',
  dress: 'apparel',
  food_snacks: 'apparel',
  furniture: 'furniture',
  generic_furniture: 'furniture',
  home_decor: 'furniture',
  kitchen_appliance: 'appliance',
  kitchenware: 'tableware',
  knitwear: 'apparel',
  laptop_tablet: 'appliance',
  lighting: 'lighting',
  office_chair: 'furniture',
  outerwear_cold: 'apparel',
  pants: 'apparel',
  personal_care_appliance: 'appliance',
  pet_products: 'apparel',
  phone_accessory: 'appliance',
  refrigerator: 'appliance',
  seating: 'furniture',
  shirt: 'apparel',
  shoes: 'apparel',
  smart_home: 'appliance',
  socks: 'apparel',
  sofa_bed: 'furniture',
  sportswear: 'apparel',
  storage: 'furniture',
  table_desk: 'furniture',
  tee: 'apparel',
  tv_monitor: 'appliance',
  underwear: 'apparel',
  washer: 'appliance',
  weather_outerwear: 'apparel',
}

const _rawTextCache = new Map<string, string>()
export function getRawProductText(product: CatalogProduct) {
  const key = product.id || product.name
  let cached = _rawTextCache.get(key)
  if (cached !== undefined) return cached
  cached = normalizeText([
    product.name,
    product.brand,
    product.category,
    product.materials,
    product.feature,
    product.craftsmanship,
    product.benefit,
    product.pairing_note,
    ...product.keywords,
    ...product.style_tags,
    ...product.room_tags,
    ...product.scenarios,
  ].join(' '))
  _rawTextCache.set(key, cached)
  return cached
}

const _dominantIntentCache = new Map<string, ProductIntent | null>()
export function getDominantIntent(text: string) {
  let cached = _dominantIntentCache.get(text)
  if (cached !== undefined) return cached
  if (_dominantIntentCache.size > 500) _dominantIntentCache.clear()

  const turns = text.split(/[；;\n]/).map((turn) => turn.trim()).filter(Boolean)
  let result: ProductIntent | null = null
  for (const turn of [...turns].reverse()) {
    const normalizedTurn = normalizeText(turn)
    const intent = productIntents.find((candidate) => candidate.userPattern.test(normalizedTurn))
    if (intent) {
      result = intent
      break
    }
  }

  if (!result) {
    const normalizedText = normalizeText(text)
    result = productIntents.find((intent) => intent.userPattern.test(normalizedText)) ?? null
  }

  _dominantIntentCache.set(text, result)
  return result
}

const _matchedIntentsCache = new Map<string, ProductIntent[]>()
export function getMatchedIntents(text: string) {
  let cached = _matchedIntentsCache.get(text)
  if (cached !== undefined) return cached
  if (_matchedIntentsCache.size > 500) _matchedIntentsCache.clear()
  const normalizedText = normalizeText(text)
  cached = productIntents.filter((intent) => intent.userPattern.test(normalizedText))
  _matchedIntentsCache.set(text, cached)
  return cached
}

export function getRequestedProductFamily(text: string) {
  const dominantIntent = getDominantIntent(text)
  return dominantIntent ? intentFamilyMap[dominantIntent.id] ?? null : null
}
