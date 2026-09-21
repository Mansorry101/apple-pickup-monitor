/**
 * 大中华区 Apple Store 静态目录（自动生成，勿手改）。
 *
 * 门店：49 家中国大陆 + 6 家香港 + 2 家澳门 = 57 家。
 * 数据源：apple.com.cn/retail/storelist/ 的 __NEXT_DATA__（2026-09 抓取）。
 *
 * 关于「区」：中国大陆的库存查询必须先提交定位
 * （GET /shop/address/location/update?state=&city=&district=），
 * 其中 district 为必填 —— 缺了它接口会一直返回 0 家店（假无货）。
 * 这里的 district 取自 Apple 自己的 locality-lookup 接口。
 *
 * 关于澳门：Apple 澳门只有零售店，没有网上商店
 * （apple.com/mo/shop/* 一律 403 "Page Not Found"），
 * 因此无法查询澳门的门店取货库存 —— 目录里保留门店信息，但标记为不可查询。
 */

export const REGIONS = {
  CN: {
    id: 'CN',
    label: '中国大陆',
    short: '大陆',
    origin: 'https://www.apple.com.cn',
    prefix: '',
    partSuffix: 'CH/A',
    lang: 'zh-CN,zh;q=0.9,en;q=0.8',
    currency: '¥',
    needsLocation: true,
    onlineStore: true,
    canaryPart: 'MH3A4CH/A',
  },
  HK: {
    id: 'HK',
    label: '香港',
    short: '香港',
    origin: 'https://www.apple.com',
    prefix: '/hk-zh',
    partSuffix: 'ZA/A',
    lang: 'zh-HK,zh;q=0.9,en;q=0.8',
    currency: 'HK$',
    needsLocation: false,
    onlineStore: true,
    canaryPart: 'MH3A4ZP/A',
  },
  MO: {
    id: 'MO',
    label: '澳门',
    short: '澳门',
    origin: 'https://www.apple.com',
    prefix: '/mo',
    partSuffix: 'ZA/A',
    lang: 'zh-MO,zh;q=0.9,en;q=0.8',
    currency: 'MOP',
    needsLocation: false,
    onlineStore: false, // 无网上商店 → 无法查询取货库存
    canaryPart: null,
  },
};

export const REGION_ORDER = ['CN', 'HK', 'MO'];

/** 可以真正查询库存的地区 */
export const SEARCHABLE_REGIONS = REGION_ORDER.filter((r) => REGIONS[r].onlineStore);

export const STORES = [
  {
    "id": "R792",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "北京荟聚",
    "slug": "livatbeijing",
    "phone": "400-009-6560",
    "address": "北京市大兴区欣宁街 15 号 北京荟聚 1 层",
    "postalCode": "100162"
  },
  {
    "id": "R645",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "朝阳大悦城",
    "slug": "chaoyangjoycity",
    "phone": "400-617-1284",
    "address": "北京市朝阳区朝阳北路 101 号",
    "postalCode": "100000"
  },
  {
    "id": "R479",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "华贸购物中心",
    "slug": "chinacentralmall",
    "phone": "400-617-1210",
    "address": "北京市朝阳区建国路 81 号华贸购物中心",
    "postalCode": "100025"
  },
  {
    "id": "R320",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "三里屯",
    "slug": "sanlitun",
    "phone": "400-617-1363",
    "address": "北京市朝阳区三里屯路 19 号院 三里屯太古里南区 7 号楼",
    "postalCode": "100027"
  },
  {
    "id": "R448",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "王府井",
    "slug": "wangfujing",
    "phone": "400-617-1205",
    "address": "北京市东城区王府井大街 138 号北京 apm",
    "postalCode": "100006"
  },
  {
    "id": "R388",
    "region": "CN",
    "province": "北京",
    "city": "北京",
    "district": "西城区",
    "name": "西单大悦城",
    "slug": "xidanjoycity",
    "phone": "400-617-1204",
    "address": "北京市西城区西单北大街 131 号大悦城",
    "postalCode": "100032"
  },
  {
    "id": "R580",
    "region": "CN",
    "province": "四川",
    "city": "成都",
    "district": "成华区",
    "name": "成都太古里",
    "slug": "taikoolichengdu",
    "phone": "400-617-1275",
    "address": "成都市锦江区中纱帽街 8 号",
    "postalCode": "610000"
  },
  {
    "id": "R502",
    "region": "CN",
    "province": "四川",
    "city": "成都",
    "district": "成华区",
    "name": "成都万象城",
    "slug": "mixcchengdu",
    "phone": "400-617-1214",
    "address": "成都市成华区双庆路 8 号万象城",
    "postalCode": "610000"
  },
  {
    "id": "R476",
    "region": "CN",
    "province": "重庆",
    "city": "重庆",
    "district": "渝中区",
    "name": "重庆北城天街",
    "slug": "paradisewalkchongqing",
    "phone": "400-617-1240",
    "address": "重庆市两江新区北城天街 8 号",
    "postalCode": "400020"
  },
  {
    "id": "R573",
    "region": "CN",
    "province": "重庆",
    "city": "重庆",
    "district": "渝中区",
    "name": "重庆万象城",
    "slug": "mixcchongqing",
    "phone": "400-617-1215",
    "address": "重庆市九龙坡区谢家湾正街 55 号",
    "postalCode": "400050"
  },
  {
    "id": "R480",
    "region": "CN",
    "province": "重庆",
    "city": "重庆",
    "district": "渝中区",
    "name": "解放碑",
    "slug": "jiefangbei",
    "phone": "400-617-1224",
    "address": "重庆市渝中区邹容路 108 号",
    "postalCode": "400010"
  },
  {
    "id": "R609",
    "region": "CN",
    "province": "辽宁",
    "city": "大连",
    "district": "西岗区",
    "name": "大连恒隆广场",
    "slug": "olympia66dalian",
    "phone": "400-613-9741",
    "address": "大连市西岗区五四路 66 号",
    "postalCode": "116000"
  },
  {
    "id": "R646",
    "region": "CN",
    "province": "福建",
    "city": "福州",
    "district": "晋安区",
    "name": "泰禾广场",
    "slug": "tahoeplaza",
    "phone": "400-617-1354",
    "address": "福州市晋安区竹屿路 6 号 东二环泰禾广场",
    "postalCode": "350000"
  },
  {
    "id": "R577",
    "region": "CN",
    "province": "广东",
    "city": "广州",
    "district": "天河区",
    "name": "天环广场",
    "slug": "parccentral",
    "phone": "400-613-9742",
    "address": "广州市天河区天河路 218 号",
    "postalCode": "510000"
  },
  {
    "id": "R639",
    "region": "CN",
    "province": "广东",
    "city": "广州",
    "district": "天河区",
    "name": "珠江新城",
    "slug": "zhujiangnewtown",
    "phone": "400-639-3601",
    "address": "广州珠江新城兴民路 222 号 天汇广场 1 层",
    "postalCode": "510623"
  },
  {
    "id": "R532",
    "region": "CN",
    "province": "浙江",
    "city": "杭州",
    "district": "上城区",
    "name": "杭州万象城",
    "slug": "mixchangzhou",
    "phone": "400-617-1304",
    "address": "杭州市上城区富春路 701 号",
    "postalCode": "310000"
  },
  {
    "id": "R471",
    "region": "CN",
    "province": "浙江",
    "city": "杭州",
    "district": "上城区",
    "name": "西湖",
    "slug": "westlake",
    "phone": "400-617-1302",
    "address": "杭州市上城区平海路 100 号",
    "postalCode": "310006"
  },
  {
    "id": "R765",
    "region": "CN",
    "province": "安徽",
    "city": "合肥",
    "district": "蜀山区",
    "name": "合肥万象城",
    "slug": "mixchefei",
    "phone": "400-000-5292",
    "address": "合肥市蜀山区潜山路 111 号 合肥万象城商场一层",
    "postalCode": "230031"
  },
  {
    "id": "R648",
    "region": "CN",
    "province": "山东",
    "city": "济南",
    "district": "历下区",
    "name": "济南恒隆广场",
    "slug": "parc66jinan",
    "phone": "400-613-9743",
    "address": "济南市历下区泉城路 188 号",
    "postalCode": "250011"
  },
  {
    "id": "R670",
    "region": "CN",
    "province": "云南",
    "city": "昆明",
    "district": "五华区",
    "name": "昆明",
    "slug": "kunming",
    "phone": "400-639-3602",
    "address": "昆明市五华区东风西路 11 号 顺城购物中心",
    "postalCode": "650031"
  },
  {
    "id": "R643",
    "region": "CN",
    "province": "江苏",
    "city": "南京",
    "district": "雨花台区",
    "name": "虹悦城",
    "slug": "wondercity",
    "phone": "400-617-1332",
    "address": "南京市雨花台区应天大街 619 号",
    "postalCode": "210000"
  },
  {
    "id": "R493",
    "region": "CN",
    "province": "江苏",
    "city": "南京",
    "district": "雨花台区",
    "name": "新街口",
    "slug": "xinjiekou",
    "phone": "400-617-1334",
    "address": "南京市玄武区中山路 100 号",
    "postalCode": "210008"
  },
  {
    "id": "R703",
    "region": "CN",
    "province": "江苏",
    "city": "南京",
    "district": "雨花台区",
    "name": "玄武湖",
    "slug": "xuanwulake",
    "phone": "400-613-9772",
    "address": "南京市鼓楼区中央路 201 号",
    "postalCode": "210009"
  },
  {
    "id": "R571",
    "region": "CN",
    "province": "广西壮族自治区",
    "city": "南宁",
    "district": "青秀区",
    "name": "南宁万象城",
    "slug": "mixcnanning",
    "phone": "400-617-1265",
    "address": "南宁市青秀区民族大道 136 号",
    "postalCode": "530022"
  },
  {
    "id": "R531",
    "region": "CN",
    "province": "浙江",
    "city": "宁波",
    "district": "海曙区",
    "name": "天一广场",
    "slug": "tianyisquare",
    "phone": "400-613-9774",
    "address": "宁波市海曙区碶闸街 155 号 天一广场",
    "postalCode": "315000"
  },
  {
    "id": "R557",
    "region": "CN",
    "province": "山东",
    "city": "青岛",
    "district": "市南区",
    "name": "青岛万象城",
    "slug": "mixcqingdao",
    "phone": "400-617-1285",
    "address": "青岛市市南区山东路 6A 号",
    "postalCode": "266000"
  },
  {
    "id": "R644",
    "region": "CN",
    "province": "福建",
    "city": "厦门",
    "district": "思明区",
    "name": "厦门新生活广场",
    "slug": "xiamenlifestylecenter",
    "phone": "400-617-1383",
    "address": "厦门市思明区嘉禾路 399 号 SM 新生活广场",
    "postalCode": "361012"
  },
  {
    "id": "R683",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "环球港",
    "slug": "globalharbor",
    "phone": "400-617-1335",
    "address": "上海市普陀区中山北路 3300 号",
    "postalCode": "200062"
  },
  {
    "id": "R678",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "静安",
    "slug": "jingan",
    "phone": "400-000-3235",
    "address": "上海市静安区南京西路 1699 号",
    "postalCode": "200040"
  },
  {
    "id": "R359",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "南京东路",
    "slug": "nanjingeast",
    "phone": "400-663-9988",
    "address": "上海市黄浦区南京东路 300 号",
    "postalCode": "200001"
  },
  {
    "id": "R389",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "浦东",
    "slug": "pudong",
    "phone": "400-617-1305",
    "address": "上海市浦东新区陆家嘴世纪大道 8 号 上海国金中心 IFC 商场 LG2－27 号店铺",
    "postalCode": "200120"
  },
  {
    "id": "R705",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "七宝",
    "slug": "qibao",
    "phone": "400-613-9773",
    "address": "上海市闵行区漕宝路 3366 号 七宝领展广场",
    "postalCode": "201101"
  },
  {
    "id": "R401",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "上海环贸 iapm",
    "slug": "shanghaiiapm",
    "phone": "400-617-1324",
    "address": "上海市徐汇区淮海中路 999 号 环贸 iapm 商场",
    "postalCode": "200031"
  },
  {
    "id": "R581",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "五角场",
    "slug": "wujiaochang",
    "phone": "400-613-9771",
    "address": "上海市杨浦区翔殷路 1099 号 上海合生汇",
    "postalCode": "200433"
  },
  {
    "id": "R390",
    "region": "CN",
    "province": "上海",
    "city": "上海",
    "district": "普陀区",
    "name": "香港广场",
    "slug": "hongkongplaza",
    "phone": "400-617-1312",
    "address": "上海市黄浦区淮海中路 282 号 香港广场北座",
    "postalCode": "200021"
  },
  {
    "id": "R793",
    "region": "CN",
    "province": "广东",
    "city": "深圳",
    "district": "罗湖区",
    "name": "前海壹方城",
    "slug": "uniwalkqianhai",
    "phone": "400-002-7805",
    "address": "深圳市宝安区新湖路 99 号 前海壹方城 L1 层",
    "postalCode": "518101"
  },
  {
    "id": "R761",
    "region": "CN",
    "province": "广东",
    "city": "深圳",
    "district": "罗湖区",
    "name": "深圳万象城",
    "slug": "mixcshenzhen",
    "phone": "400-050-1588",
    "address": "深圳市罗湖区宝安南路 1881 号 深圳万象城（一期）B1 层",
    "postalCode": "518001"
  },
  {
    "id": "R484",
    "region": "CN",
    "province": "广东",
    "city": "深圳",
    "district": "罗湖区",
    "name": "深圳益田假日广场",
    "slug": "holidayplazashenzhen",
    "phone": "400-617-1254",
    "address": "深圳市南山区深南大道 9028 号益田假日广场",
    "postalCode": "518000"
  },
  {
    "id": "R576",
    "region": "CN",
    "province": "辽宁",
    "city": "沈阳",
    "district": "大东区",
    "name": "沈阳万象城",
    "slug": "mixcshenyang",
    "phone": "400-617-1274",
    "address": "沈阳市和平区青年大街 288 号",
    "postalCode": "110000"
  },
  {
    "id": "R534",
    "region": "CN",
    "province": "辽宁",
    "city": "沈阳",
    "district": "大东区",
    "name": "中街大悦城",
    "slug": "zhongjiejoycity",
    "phone": "400-617-1252",
    "address": "沈阳市大东区小东路 5 号",
    "postalCode": "110042"
  },
  {
    "id": "R688",
    "region": "CN",
    "province": "江苏",
    "city": "苏州",
    "district": "吴中区",
    "name": "苏州",
    "slug": "suzhou",
    "phone": "400-613-9775",
    "address": "苏州市苏州工业园区 苏州中心商场",
    "postalCode": "215021"
  },
  {
    "id": "R637",
    "region": "CN",
    "province": "天津",
    "city": "天津",
    "district": "南开区",
    "name": "天津大悦城",
    "slug": "tianjinjoycity",
    "phone": "400-617-1262",
    "address": "天津市南开区南门外大街 2 号",
    "postalCode": "300199"
  },
  {
    "id": "R579",
    "region": "CN",
    "province": "天津",
    "city": "天津",
    "district": "南开区",
    "name": "天津恒隆广场",
    "slug": "riverside66tianjin",
    "phone": "400-613-9744",
    "address": "天津市和平区兴安路 166 号",
    "postalCode": "300041"
  },
  {
    "id": "R638",
    "region": "CN",
    "province": "天津",
    "city": "天津",
    "district": "南开区",
    "name": "天津万象城",
    "slug": "mixctianjin",
    "phone": "400-613-9745",
    "address": "天津市河西区乐园道 9 号",
    "postalCode": "300201"
  },
  {
    "id": "R766",
    "region": "CN",
    "province": "浙江",
    "city": "温州",
    "district": "瓯海区",
    "name": "温州万象城",
    "slug": "mixcwenzhou",
    "phone": "400-000-2385",
    "address": "浙江省温州市瓯海区瓯越大道1999号 温州万象城 L1层",
    "postalCode": "325000"
  },
  {
    "id": "R574",
    "region": "CN",
    "province": "江苏",
    "city": "无锡",
    "district": "梁溪区",
    "name": "无锡恒隆广场",
    "slug": "center66wuxi",
    "phone": "400-617-1325",
    "address": "无锡市梁溪区 人民中路 139 号",
    "postalCode": "214000"
  },
  {
    "id": "R575",
    "region": "CN",
    "province": "湖北",
    "city": "武汉",
    "district": "江汉区",
    "name": "武汉",
    "slug": "wuhan",
    "phone": "400-638-3818",
    "address": "武汉市江汉区解放大道 690 号 武商 MALL B 座 2F",
    "postalCode": "430022"
  },
  {
    "id": "R617",
    "region": "CN",
    "province": "湖南",
    "city": "长沙",
    "district": "芙蓉区",
    "name": "长沙",
    "slug": "changsha",
    "phone": "400-604-3168",
    "address": "长沙市芙蓉区解放西路 188 号 长沙国金中心一层",
    "postalCode": "410000"
  },
  {
    "id": "R572",
    "region": "CN",
    "province": "河南",
    "city": "郑州",
    "district": "二七区",
    "name": "郑州万象城",
    "slug": "mixczhengzhou",
    "phone": "400-617-1264",
    "address": "郑州市二七区民主路 10 号",
    "postalCode": "450000"
  },
  {
    "id": "R673",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "apm Hong Kong",
    "slug": "apmhongkong",
    "phone": "35728900",
    "address": "觀塘觀塘道 418 號",
    "postalCode": ""
  },
  {
    "id": "R499",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "Canton Road",
    "slug": "cantonroad",
    "phone": "39798800",
    "address": "尖沙咀廣東道 100 號",
    "postalCode": ""
  },
  {
    "id": "R409",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "Causeway Bay",
    "slug": "causewaybay",
    "phone": "39793100",
    "address": "希慎廣場 銅鑼灣軒尼詩道 500 號",
    "postalCode": ""
  },
  {
    "id": "R485",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "Festival Walk",
    "slug": "festivalwalk",
    "phone": "39793600",
    "address": "又一城 九龍塘達之路 80 號",
    "postalCode": ""
  },
  {
    "id": "R428",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "ifc mall",
    "slug": "ifcmall",
    "phone": "39721500",
    "address": "國際金融中心商場 中環金融街 8 號",
    "postalCode": ""
  },
  {
    "id": "R610",
    "region": "HK",
    "province": "香港",
    "city": "香港",
    "district": "",
    "name": "New Town Plaza",
    "slug": "newtownplaza",
    "phone": "38997800",
    "address": "新城市廣場 1 期 L4 沙田沙田正街 18 號",
    "postalCode": ""
  },
  {
    "id": "R672",
    "region": "MO",
    "province": "澳門",
    "city": "澳門",
    "district": "",
    "name": "澳門銀河",
    "slug": "galaxymacau",
    "phone": "87919000",
    "address": "路氹城 澳門銀河™時尚匯",
    "postalCode": ""
  },
  {
    "id": "R697",
    "region": "MO",
    "province": "澳門",
    "city": "澳門",
    "district": "",
    "name": "路氹金光大道",
    "slug": "cotaistrip",
    "phone": "87917000",
    "address": "路氹城 倫敦人購物中心",
    "postalCode": ""
  }
];

/** id → store 的索引 */
export const STORE_BY_ID = Object.fromEntries(STORES.map((s) => [s.id, s]));

/**
 * 城市目录：按「地区 → 省/直辖市 → 城市」组织，供界面做级联下拉。
 * key 形如 "CN:上海"，港澳则用 "HK:香港" / "MO:澳門"。
 */
export const CITY_KEY = (region, city) => `${region}:${city}`;

export const CITIES = (() => {
  const map = new Map();
  for (const s of STORES) {
    const key = CITY_KEY(s.region, s.city);
    if (!map.has(key)) {
      map.set(key, {
        key,
        region: s.region,
        regionLabel: REGIONS[s.region].label,
        province: s.province,
        city: s.city,
        district: s.district,
        searchable: Boolean(REGIONS[s.region].onlineStore),
        stores: [],
      });
    }
    map.get(key).stores.push(s);
  }
  for (const c of map.values()) {
    c.stores.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    c.storeCount = c.stores.length;
  }
  const regionRank = (r) => REGION_ORDER.indexOf(r);
  return [...map.values()].sort(
    (a, b) => regionRank(a.region) - regionRank(b.region)
      || a.province.localeCompare(b.province, 'zh')
      || a.city.localeCompare(b.city, 'zh'),
  );
})();

export const CITY_BY_KEY = Object.fromEntries(CITIES.map((c) => [c.key, c]));

/** 门店的展示名：城市 + 门店名 */
export function storeDisplay(id) {
  const s = STORE_BY_ID[id];
  if (!s) return id;
  return `${s.city} · ${s.name}`;
}

/** 门店标签：城市 + 门店名（城市已能表明地区，不必再加"中国大陆/香港"） */
export function storeLabel(id) {
  const s = STORE_BY_ID[id];
  if (!s) return id;
  return `${s.city} · ${s.name}`;
}
