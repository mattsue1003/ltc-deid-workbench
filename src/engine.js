/* 長照資料去識別化｜個資偵測引擎
 * 純本機規則比對：輸入多段文字（segments），輸出每段的標記區間與實體清單。
 * 不使用網路、不儲存任何資料。 */
(function (root) {
  'use strict';

  // ───────── 字典 ─────────
  const SURNAME_COMPOUND = ['歐陽', '司馬', '諸葛', '上官', '司徒', '張簡', '范姜', '東方', '皇甫', '夏侯', '長孫', '慕容',
    '公孫', '令狐', '端木', '尉遲', '鍾離', '宇文', '呼延', '南宮', '西門', '軒轅', '周黃', '張廖', '陳黃', '劉張', '江謝'];
  const SURNAME_SINGLE = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董溫唐藍蔣石古紀姚連馮歐程湯田康姜白汪鄒尤巫鐘黎涂龔嚴韓袁金童陸夏柳凃邵錢伍倪于譚駱熊任甘秦顧毛章史官萬俞雷粘饒葛闕孔利邢費殷褚岳尹鄞彭麥封房郝花莫裴龐祝歐陽易冉喬牛鄔熊辜黃侯應賀符包宮伍葉滕寇谷鄞冷艾邰蒲覃凌魯段龍伍游';
  const SURNAME_SET = new Set(SURNAME_SINGLE.split(''));

  // 稱謂：長的放前面
  const TITLES = ['職能治療師', '物理治療師', '語言治療師', '心理師', '個管師', '社工師', '護理師', '治療師', '營養師', '藥師',
    '居服員', '照服員', '督導', '主任', '院長', '所長', '老師', '醫師', '醫生', '個管', '社工', '護士',
    '先生', '小姐', '女士', '太太', '伯伯', '伯母', '阿伯', '爺爺', '奶奶', '阿公', '阿嬤', '阿媽', '婆婆', '阿婆',
    '公公', '阿姨', '叔叔', '阿叔', '嬸嬸', '大哥', '大姐', '大嫂', '姐姐', '姊姊', '哥哥', '媽媽', '爸爸', '老闆',
    '伯', '姨', '叔', '嬸', '嬤', '姐', '姊', '哥', '嫂', '婆'];
  // 全名＋這些稱謂時，才把前面當成全名（避免「高血壓阿嬤」）
  const FULLNAME_TITLES = ['職能治療師', '物理治療師', '語言治療師', '心理師', '個管師', '社工師', '護理師', '治療師', '營養師',
    '藥師', '居服員', '照服員', '督導', '主任', '老師', '醫師', '先生', '小姐', '女士', '太太'];
  const STAFF_TITLES = new Set(['職能治療師', '物理治療師', '語言治療師', '心理師', '個管師', '社工師', '護理師', '治療師', '營養師',
    '藥師', '居服員', '照服員', '督導', '主任', '院長', '所長', '老師', '醫師', '醫生', '個管', '社工', '護士']);

  // 標籤 → 角色
  const ROLE_LABELS = [
    ['個案', ['個案姓名', '案主姓名', '服務對象', '被照顧者', '受照顧者', '個案', '案主', '長者', '住民', '學員', '姓名', '病人', '患者']],
    ['家屬', ['緊急聯絡人', '主要照顧者', '案孫女', '案孫子', '聯絡人', '照顧者', '代理人', '監護人', '家屬', '案妻', '案夫', '案子', '案女', '案媳',
      '案孫', '案兄', '案弟', '案姐', '案姊', '案妹', '案母', '案父', '案婿', '長子', '次子', '三子', '么子', '長女', '次女', '三女', '么女',
      '兒子', '女兒', '媳婦', '女婿', '孫子', '孫女', '配偶', '妻子', '丈夫', '老伴', '外孫', '姪子', '姪女', '外甥']],
    ['看護', ['外籍看護工', '外籍看護', '外籍家庭看護', '看護工', '看護', '外看', '移工', '印傭', '菲傭', '越傭', '幫傭', '外勞']],
    ['人員', ['照顧管理專員', '職能治療師', '物理治療師', '語言治療師', '照管專員', '主治醫師', '評估人員', '訪視人員', '個管師', '居服員',
      '照服員', '居督', '督導', '社工師', '社工', '護理師', '護士', '醫師', '醫生', '治療師', '營養師', '藥師', '填表人', '評估者',
      '記錄者', '紀錄者', '記錄人', '紀錄人', '承辦人', '個管', '照專', '簽名', '單位負責人', '負責人']]
  ];
  const LABEL_LIST = [];
  ROLE_LABELS.forEach(([role, arr]) => arr.forEach(w => LABEL_LIST.push([w, role])));
  LABEL_LIST.sort((a, b) => b[0].length - a[0].length);

  // 名字不可能出現的字（遇到就停）
  const NAME_STOP = new Set(('今昨於表說的在有為因主與和及自已目現每需會可無很也都是稱先後到從曾仍將要能被讓把向對等之並另或但且則就才又再皆均亦乃即個案家屬住' +
    '日月年時分天週次位名人歲床號電話地址生出性男女病診醫院所心這那此其他她它我你們了過著嗎呢吧啊喔哦一二三四五六七八九十兩幾多少上下左右前內外' +
    '來去走看聽吃喝睡坐站跌倒痛藥量協幫陪負責血壓糖尿失智中風骨折開刀手術檢查治療復健評估訪視照顧服務').split(''));
  // 常見與姓氏同字開頭的詞（不是人名）
  const NOT_NAMES = new Set(['葉黃素', '江蘇', '黃金', '林業', '王國', '陳列', '高雄', '蘇聯', '朱紅', '高林', '張羅', '周全', '何方', '方便', '曾經', '高溫', '黃色', '白色', '高血壓', '高血糖', '高血脂', '高齡', '林口', '周末', '周邊', '李子', '方便', '方面', '方式', '方法', '方向',
    '王道', '許多', '何時', '何謂', '於是', '張力', '張開', '黃疸', '白天', '白內障', '江湖', '石頭', '古早', '田地', '金錢', '康復',
    '程度', '高度', '溫度', '陳述', '連續', '連結', '連絡', '包括', '包含', '包尿布', '曾經', '周圍', '黃色', '白色', '藍色', '朱紅',
    '方案', '安全', '馬上', '馬桶', '石膏', '段落', '雷射', '童年', '史料', '簡單', '簡易', '莊園', '秦朝', '孫子', '孫女', '高中',
    '高雄', '林園', '宜蘭', '花蓮', '金門', '彭湖', '高樹', '萬丹', '萬華', '石門', '江南', '龍潭', '湯匙', '杜絕', '施打', '施行',
    '何者', '何處', '利用', '利尿', '利尿劑', '費用', '殷切', '任何', '任意', '應該', '應用', '賀爾蒙', '易怒', '易累', '魯莽',
    '凌晨', '龍骨', '段數', '房間', '房子', '花錢', '花費', '莫名', '喬裝', '牛奶', '包裝', '宮頸', '谷底', '冷氣', '冷水', '艾草',
    '蒲公英', '符合', '葛根', '孔洞', '岳父', '岳母', '尹', '封閉', '麥片', '毛巾', '毛病', '章節', '顧客', '顧問', '雷同', '萬一',
    '俞', '甘草', '秦', '熊貓', '倪', '游泳', '游戲', '彭湃', '錢包', '夏天', '夏季', '柳丁', '陸續', '童話', '金額', '韓國',
    '嚴重', '嚴格', '黎明', '龔', '汪洋', '尤其', '尤其是', '白開水', '姜', '康健', '湯藥', '程序', '馮', '歐洲', '姚',
    '紀錄', '紀念', '紀律', '唐突', '溫水', '溫和', '溫暖', '董事', '馬路', '阮', '卓越', '丁香', '薛', '曹', '侯', '傅',
    '杜', '鄧', '宋', '范', '戴', '孫', '魏', '翁', '柯', '顏', '趙', '梁', '盧', '余', '沈', '施', '胡', '詹', '彭', '游',
    '鍾', '朱', '簡', '潘', '高', '羅', '蕭', '何', '江', '呂', '莊', '蘇', '葉', '周', '徐', '賴', '廖', '邱', '曾', '洪',
    '郭', '謝', '鄭', '許', '楊', '蔡', '劉', '吳', '王', '李', '張', '黃', '林', '陳', '石化', '金屬', '方塊', '高爾夫',
    '高低', '高興', '黃昏', '黃金', '林業', '王國', '許可', '吳郭魚', '葉子', '葉酸', '周遭', '洪水', '邱', '游走', '余額',
    '施工', '施力', '連帶', '連接', '連動', '連忙', '江水', '朱古力', '彭', '溫熱', '湯圓', '程式', '白米', '白飯', '史',
    '雷', '甘', '毛', '易', '冉', '喬', '牛', '房', '花', '莫', '裴', '龐', '祝', '應', '包', '宮', '谷', '冷', '艾', '蒲',
    '覃', '凌', '魯', '段', '龍', '符', '賀', '辜', '鄔', '麥', '封', '郝', '岳', '孔', '殷', '費', '利', '褚', '邢', '闕',
    '葛', '饒', '粘', '萬', '官', '章', '顧', '秦', '任', '熊', '駱', '譚', '于', '倪', '伍', '錢', '邵', '凃', '柳', '夏',
    '陸', '童', '金', '袁', '韓', '嚴', '龔', '涂', '黎', '鐘', '巫', '尤', '鄒', '汪', '白', '姜', '康', '田', '湯', '程',
    '歐', '馮', '連', '紀', '古', '石', '蔣', '藍', '唐', '溫', '董', '馬', '卓', '丁']);

  const MED_LATIN_ALLOW = new Set(('Email Gmail Barthel Lawton Parkinson Alzheimer Alzheimers Foley Brunnstrom Berg Tinetti Glasgow Mini Line Facebook Google Excel Word ' +
    'Apple Android Windows Hello Ok Okay January February March April May June July August September October November December ' +
    'Monday Tuesday Wednesday Thursday Friday Saturday Sunday The This That And For With From Note Total Score Yes No Not None Other Others ' +
    'Timed Up Go Test Scale Index Activities Daily Living Instrumental Functional Independence Measure Assessment Report Case Care Plan ' +
    'Covid Stroke Diabetes Dementia Normal Left Right Mild Moderate Severe Good Fair Poor Trace Zero Hospital Clinic Center Home Day ' +
    'Pain Fall Walker Cane Wheelchair Bed Bath Toilet Mr Mrs Ms Dr Oxygen Insulin Aspirin Panadol Tylenol Lasix Plavix Morphine Name Date ' +
    'Page Of In On At To By As Is Are Was Be Do Did Has Have Had Can Will Shall Should Would Could May Might Must Gait Balance Strength Range ' +
    'Motion Upper Lower Extremity Muscle Power Sensation Cognition Memory Attention Vision Hearing Speech Swallowing Feeding Dressing ' +
    'Grooming Transfer Ambulation Stairs Bowel Bladder Mobility Sitting Standing Supine Prone Side Lying Kg Cm Mmhg Bpm').split(/\s+/));

  const CITIES = ['臺北市', '台北市', '新北市', '桃園市', '臺中市', '台中市', '臺南市', '台南市', '高雄市', '基隆市', '新竹市', '嘉義市',
    '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '台東縣', '澎湖縣', '金門縣',
    '連江縣', '桃園縣', '臺北縣', '台北縣', '臺中縣', '台中縣', '臺南縣', '台南縣', '高雄縣'];

  const ORG_SUFFIX = ['醫學中心', '醫院', '診所', '衛生所', '健康服務中心', '日間照顧中心', '日照中心', '長期照顧管理中心', '照顧管理中心',
    '照管中心', '長照中心', '居家護理所', '護理之家', '養護中心', '安養中心', '養護所', '養護之家', '綜合長照機構', '長照機構', '居家服務中心',
    '居服中心', '基金會', '協會', '社區關懷據點', '關懷據點', '巷弄長照站', '文健站', '復健中心', '物理治療所', '職能治療所', '藥局',
    '分院', '教會', '里辦公處', '公所', '小規模多機能', '團體家屋', '家庭托顧', '輔具中心', '輔具資源中心'];
  const ORG_BOUNDARY = ['曾參加', '參加', '參與', '加入', '單位名稱', '機構名稱', '服務單位', '雇用單位', '僱用單位', '名稱', '轉介至', '轉介到', '轉介', '轉至', '轉到', '送至', '送到', '送往', '前往', '入住', '住進', '住在', '回到', '返回',
    '就醫', '就診', '回診', '出院', '住院', '至', '到', '於', '在', '去', '往', '從', '由', '與', '和', '及', '跟', '的', '是', '為', '被',
    '經', '今日', '昨日', '今天', '昨天', '明天', '個案', '案主', '家屬', '目前', '曾在', '曾於', '曾', '並', '且', '、', '／', '/'];
  const ORG_GENERIC = new Set(['地區', '區域', '社區', '附近', '鄰近', '大型', '一般', '公立', '私立', '教學', '當地', '其他', '某', '該',
    '本', '這家', '那家', '這間', '那間', '住家', '住家附近', '各', '大', '小', '區域教學', '地區教學', '綜合', '專科', '這個', '那個',
    '任何', '每間', '每家', '多家', '兩家', '一家', '哪家', '哪間', '他院', '其', '外院', '本院', '本所', '本中心', '我們', '大醫院',
    '小診所', '各大', '附設', '鄰近的', '前一家', '上一家', '同一家']);

  const COMMON_SURNAME = new Set('陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏'.split(''));
  // 名字後面常接的詞（用來判斷名字到哪裡結束）
  const FOLLOW = /^(晚上|早上|白天|中午|下午|每天|每週|會|要|想|互動|互相|一起|一同|兩人|等人|近期|近日|近來|最近|參與|參加|喜歡|今天|今日|目前|表示|自述|主訴|提到|認為|覺得|希望|同意|拒絕|本身|平時|平日|每天|每週|每日|經常|常常|使用|需要|因為|由於|已經|仍然|一直|沒有|不會|可以|能夠|接受|進行|出席|來到|回到|住在|居住|與|和|及|於|在|的|是|有|說|因|由|到|被|把|將|也|都|則|就|才|又|再|曾|仍)/;
  const PLACE_END = new Set('省市縣區鄉鎮村里路街巷號樓籍科院所部局處系族館站校隊組會社團島山湖河'.split(''));
  const AMBIG_SURNAME = new Set('曾連何於尤方高白石金馬古田包房花冷易任應利費甘雷毛史常向和左右'.split(''));
  const COMMON_WORDS = new Set('討論 確認 說明 告知 溝通 聯繫 調整 開立 診斷 處方 喘息 交通 服務 項目 頻率 備註 關係 性別 年齡 電話 地址 日期 診斷 備註 狀況 情形 練習 訓練 評估 負責 處理 聯繫 聯絡 到宅 前往 早上 早餐 午餐 晚餐 陪伴 陪同 帶領 進行 執行 提供 安排 申請 轉介 追蹤 觀察 測量 量測 記錄 紀錄 希望 協助 指導 訓練 建議 需要 使用 表示 自述 自行 情緒 回診 外出 獨居 同住 陪同 照顧 返家 主訴 狀況 身體 精神 平時 晚上 白天 本身 意願 配合 反應 擔心 認為 覺得 提到 告知 拒絕 同意 經濟 負擔 皆可 均可 尚可 能力 功能 部分 部份 完全 偶爾 經常 常常 有時 需要 沒有 無法 可以 已經 仍然 依然 還是 只有 稍微 非常 相當 較為 比較 狀態 情形 情況 意識 清楚 清醒 穩定 良好 不佳 正常 異常 本人 自己 親自 兩人 一同 一起 共同 分別 輪流 固定 定期 每天 每週 每月 平日 假日 週末 早上 中午 下午 傍晚 夜間 半夜 凌晨 最近 近期 近日 先前 之前 以前 過去 後來 之後 以後 未來 日後 現在 現今 如今 當時 當天 隔天 簽名 簽章 簽收 簽署 填寫 確認 核章 簽到'.split(' '));
  // ───────── 英文／外籍 ─────────
  const PARTICLE = '(?:bin|binti|bte|bt|van|von|de|da|del|der|den|di|du|la|le|al|el|dos|das|do|ter|ten|mac|mc|y)';
  const NAME_WORD = "[A-Z](?:[a-z]|['’][A-Z])[a-zA-Z'’\\-]*";   // Smith、O'Brien、McDonald；DOB、SSN 這種全大寫縮寫不算
  // 英文姓名：1–5 個大寫開頭的字，可夾 bin/binti/van/de 等，或縮寫 J.
  const LATIN_NAME = `${NAME_WORD}(?:[ \\t](?:${PARTICLE}[ \\t])?(?:${NAME_WORD}|[A-Z]\\.)){0,4}`;   // 字間只允許一個空白（避免吃到後面的欄位）
  const EN_LABELS = [
    ['個案', ['Patient Name', 'Client Name', 'Resident Name', 'Full Name', 'Patient', 'Client', 'Resident', 'Participant', 'Service User', 'Name', 'Surname', 'First Name', 'Last Name', 'Given Name', 'Family Name']],
    ['家屬', ['Emergency Contact', 'Next of Kin', 'Contact Person', 'Primary Caregiver', 'Family Caregiver', 'Guardian', 'Spouse', 'Husband', 'Wife', 'Son', 'Daughter', 'Brother', 'Sister', 'Mother', 'Father', 'Grandson', 'Granddaughter', 'Niece', 'Nephew', 'Relative', 'Contact']],
    ['看護', ['Foreign Caregiver', 'Domestic Helper', 'Live-in Caregiver', 'Helper', 'Aide', 'Carer', 'Caregiver']],
    ['人員', ['Assessed by', 'Evaluated by', 'Completed by', 'Prepared by', 'Reviewed by', 'Referred by', 'Reported by', 'Recorded by', 'Signed by', 'Signature', 'Therapist', 'Assessor', 'Evaluator', 'Case Manager', 'Care Manager', 'Social Worker', 'Nurse', 'Physician', 'Doctor', 'Clinician', 'Interviewer', 'Staff']]
  ];
  const EN_STOPWORDS = new Set('Date Phone Address Email Male Female Yes No None Unknown Not Applicable Self Same Above Below See Mobile Home Work Tel Fax Age Sex Gender Birth Of The A An And Or To From Room Bed Unit'.split(' '));
  const KIN_EN = /\b(?:his|her|their|the)?\s*(daughter|son|wife|husband|brother|sister|mother|father|granddaughter|grandson|niece|nephew|caregiver|carer|helper|neighbou?r|friend|nurse|therapist|doctor|physician|social worker)\s+(?=[A-Z])/gi;
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_RE = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
  const NUMC = '0-9０-９一二三四五六七八九十百零〇';
  const isCJK = ch => !!ch && /[一-鿿㐀-䶿]/.test(ch);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const PRIORITY = { custom: 100, email: 90, idno: 88, phone: 85, number: 80, birth: 75, date: 70, address: 65, name: 60, title: 55, org: 50, latin: 40, suggest: 30 };

  const CAT_INFO = {
    name: { label: '人名', color: 'name' },
    idno: { label: '身分證／居留證', color: 'id' },
    phone: { label: '電話', color: 'phone' },
    email: { label: 'Email／帳號', color: 'phone' },
    number: { label: '病歷號／案號／卡號', color: 'id' },
    birth: { label: '出生日期', color: 'date' },
    date: { label: '日期', color: 'date' },
    address: { label: '地址', color: 'addr' },
    org: { label: '機構名稱', color: 'org' },
    custom: { label: '自訂遮蔽詞', color: 'custom' },
    field: { label: '表單欄位（掃描檔）', color: 'custom' }
  };

  // ───────── 日期工具 ─────────
  function mkDate(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 200) y += 1911;
    if (y < 1890 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return dt;
  }
  const DAY = 86400000;
  function ageBand(birth, ref, band) {
    let age = ref.getUTCFullYear() - birth.getUTCFullYear();
    if (ref.getUTCMonth() < birth.getUTCMonth() || (ref.getUTCMonth() === birth.getUTCMonth() && ref.getUTCDate() < birth.getUTCDate())) age--;
    if (age < 0) return '【出生日期】';
    if (age >= 90) return '【90歲以上】';
    const lo = Math.floor(age / band) * band;
    return `【${lo}–${lo + band - 1}歲】`;
  }
  // 中文數字 → 數字（三十四 → 34、一一三 → 113）
  function cnNum(t) {
    const d = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百]/.test(t)) return +[...t].map(c => d[c]).join('');
    let n = 0, cur = 0;
    for (const c of t) { if (c === '百') { n += (cur || 1) * 100; cur = 0; } else if (c === '十') { n += (cur || 1) * 10; cur = 0; } else cur = d[c]; }
    return n + cur;
  }
  const toHalf = s => s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // ───────── 主流程 ─────────
  function analyze(segments, opt) {
    opt = Object.assign({
      names: [],          // [{name, role}]
      custom: [],         // [{word, rep}]
      allow: [],          // 不遮蔽詞
      ageBand: 5,
      dateMode: 'relative', // relative | yearmonth | keep
      refDate: new Date(),
      addrLevel: 'district', // district | city | none
      forced: []          // [{seg, start, end, cat, rep}]  (Excel 欄位角色)
    }, opt || {});
    const allow = new Set(opt.allow.map(s => s.trim()).filter(Boolean));
    const refDate = new Date(Date.UTC(opt.refDate.getFullYear(), opt.refDate.getMonth(), opt.refDate.getDate()));

    const cands = segments.map(() => []);   // 每段候選
    const persons = new Map();               // 全名 → {role, first}
    const titleKeys = [];
    const cjkAlias = new Map();   // 中文譯名 → 英文全名
    const add = (si, s, e, o) => { if (e > s) cands[si].push(Object.assign({ s, e }, o)); };

    const notePerson = (name, role, si, pos) => {
      if (!name || NOT_NAMES.has(name) || allow.has(name)) return false;
      const p = persons.get(name);
      const order = si * 1e7 + pos;
      if (!p) persons.set(name, { role: role || null, first: order });
      else { if (!p.role && role) p.role = role; if (order < p.first) p.first = order; }
      return true;
    };

    // 名單
    for (const n of opt.names) if (n.name && n.name.length >= 2) notePerson(n.name.trim(), n.role || null, 1e6, 0);

    const surnameAt = (t, i) => {
      for (const c of SURNAME_COMPOUND) if (t.startsWith(c, i)) return c.length;
      return SURNAME_SET.has(t[i]) ? 1 : 0;
    };
    const titleAt = (t, i, list) => { for (const ti of (list || TITLES)) if (t.startsWith(ti, i)) return ti; return null; };
    const roleBefore = (t, pos) => {
      let j = pos;
      while (j > 0 && /[\s:：,，(（「『為是]/.test(t[j - 1]) && pos - j < 4) j--;
      for (const [w, role] of LABEL_LIST) if (j >= w.length && t.substr(j - w.length, w.length) === w) return { role, label: w, at: j - w.length };
      // 表單常把欄位名稱拆開排版：「姓　　名」「聯 絡 人」→ 去掉中間空白再比對
      const raw = t.slice(Math.max(0, j - 24), j);
      if (/\s/.test(raw)) {
        const compact = raw.replace(/[ \t\u3000]+/g, '');
        for (const [w, role] of LABEL_LIST) if (w.length >= 2 && compact.endsWith(w)) return { role, label: w, at: j - 1 };
      }
      return null;
    };
    // 從 i 起抓中文姓名（姓＋1–2 字）
    const takeName = (t, i) => {
      const sl = surnameAt(t, i);
      if (!sl) return null;
      if (titleAt(t, i + sl)) return null; // 王伯伯 → 交給稱謂規則
      const c1 = t[i + sl];
      if (!isCJK(c1) || NAME_STOP.has(c1)) return null;
      const c2 = t[i + sl + 1];
      let len = sl + 1;
      if (isCJK(c2) && !NAME_STOP.has(c2) && !titleAt(t, i + sl + 1)) len = sl + 2;
      // 冠夫姓（李張秀蘭、吳林玉英）：第二字也是常見姓，後面再接兩個字
      if (sl === 1 && len === 3 && SURNAME_SET.has(c1)) {
        const c3 = t[i + 3], c4 = t[i + 4];
        const endOk = !isCJK(c4) || NAME_STOP.has(c4) || !!titleAt(t, i + 4) || FOLLOW.test(t.slice(i + 4));
        if (isCJK(c3) && !NAME_STOP.has(c3) && !titleAt(t, i + 3) && !FOLLOW.test(t.slice(i + 3)) && (endOk || COMMON_SURNAME.has(c1))) len = 4;
      }
      const name = t.substr(i, len);
      if (NOT_NAMES.has(name)) return null;
      return name;
    };
    // 前一段只有欄位名稱（表格左格「個案姓名」、右格才是內容）→ 當成這一段的前綴
    const LABELISH = /(姓名|名字|個案|案主|照顧者|聯絡人|家屬|看護|監護人|代理人|出生|生日|日期|電話|手機|地址|住址|戶籍|身分證|身份證|案號|病歷|編號|卡號|評估者|評估人員|人員|簽名|督導|個管|治療師|護理師|社工|居服員|照服員|填表人|負責人)\s*[:：]?$/;
    const prefixOf = si => {
      if (si === 0) return '';
      const p = segments[si - 1].trim().replace(/[ \t\u3000]+/g, '');   // 「姓　　名」→「姓名」
      if (p.length < 2 || p.length > 8 || /\d/.test(p) || !LABELISH.test(p)) return '';
      return p.replace(/[:：]?$/, '：');
    };

    // Pass 1：規則比對（t = 前綴＋本段；落在前綴裡的結果丟掉）
    const addG = add;
    segments.forEach((t0, si) => {
      const P = prefixOf(si).length, t = prefixOf(si) + t0;
      const add = (si_, s, e, o) => { if (s >= P) addG(si_, s - P, e - P, o); };
      let m;
      // 自訂遮蔽詞
      for (const c of opt.custom) {
        if (!c.word) continue;
        const re = new RegExp(esc(c.word), 'g');
        while ((m = re.exec(t))) add(si, m.index, m.index + c.word.length, { cat: 'custom', key: c.word, rep: c.rep || '【已遮蔽】', pri: PRIORITY.custom });
      }
      // Email
      const reMail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
      while ((m = reMail.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'email', rep: '【Email】', pri: PRIORITY.email });
      // LINE / FB 帳號
      const reAcct = /(LINE\s*ID|Line\s*ID|LINE|Line|line|臉書|FB|IG)\s*[:：]\s*([A-Za-z0-9._@-]{3,})/g;
      while ((m = reAcct.exec(t))) { const s = m.index + m[0].length - m[2].length; add(si, s, s + m[2].length, { cat: 'email', rep: '【帳號】', pri: PRIORITY.email }); }
      // 身分證／居留證
      const reId = /(?<![A-Za-z0-9])[A-Za-z][1289ABCDabcd]\d{8}(?![0-9])/g;
      while ((m = reId.exec(t))) add(si, m.index, m.index + 10, { cat: 'idno', rep: '【身分證號】', pri: PRIORITY.idno });
      // 手機
      const reMob = /(?<![0-9])(?:\+?886[-\s.]?|0)9\d{2}[-\s.]?\d{3}[-\s.]?\d{3}(?![0-9])/g;
      while ((m = reMob.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone });
      // 市話
      const reTel = /(?<![0-9])(?:\(0[2-8]\d{0,2}\)|（0[2-8]\d{0,2}）|0[2-8]\d{0,2})[-\s]?\d{3,4}[-\s]?\d{4}(?:\s*(?:#|分機|轉)\s*\d{1,5})?(?![0-9])/g;
      while ((m = reTel.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone });
      // 標籤後的電話（沒有區碼）
      const reTelL = /(電話|市話|手機|聯絡電話|連絡電話|行動電話|TEL|Tel|tel|Phone|phone)\s*[:：]?\s*([0-9()（）#\-\s]{7,20}[0-9])/g;
      while ((m = reTelL.exec(t))) { const s = m.index + m[0].length - m[2].length; add(si, s, s + m[2].length, { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone - 1 }); }
      // 各式編號
      const reNo = /(病歷號碼|病歷號|病歷|長照案號|個案編號|個案號|案號|身障手冊|身心障礙證明|手冊編號|證明編號|健保卡號|健保卡|卡號|保險證號|床號|房號|編號|帳號|身分證字號|身分證號|身份證字號|身份證號|統一證號|居留證號|護照號碼|ID|No\.?)\s*[:：#]?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,}(?:\s\d{4}){0,3})/g;
      while ((m = reNo.exec(t))) { const s = m.index + m[0].length - m[2].length; if (/^[A-Za-z][1289ABCDabcd]\d{8}$/.test(m[2])) continue; add(si, s, s + m[2].length, { cat: 'number', rep: '【編號】', pri: PRIORITY.phone + 1 }); }
      const reHealth = /(?<![0-9])\d{4}\s\d{4}\s\d{4}(?![0-9])/g;
      while ((m = reHealth.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'number', rep: '【編號】', pri: PRIORITY.number });
      if (opt.ocr) {
        // 掃描辨識容錯：號碼中夾 1–2 個誤認字（? O l I | 等）
        const reNoisy = /(?<![0-9A-Za-z])[0-9?!OoIl|][0-9?!OoIl|\-\s]{6,14}[0-9?!OoIl|](?![0-9A-Za-z])/g;
        while ((m = reNoisy.exec(t))) {
          const d = (m[0].match(/[0-9]/g) || []).length, bad = (m[0].match(/[?!OoIl|]/g) || []).length;
          if (d >= 6 && bad >= 1 && bad <= 2) add(si, m.index, m.index + m[0].length, /^0/.test(m[0]) ? { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone - 2 } : { cat: 'number', rep: '【號碼】', pri: PRIORITY.number - 6 });
        }
        // 辨識出的長串數字（電話、證號讀錯幾個字也算）
        const reDigits = /(?<![0-9A-Za-z])[0-9?!OoIl|][0-9?!OoIl|\-.\s]{7,16}[0-9?!OoIl|](?![0-9A-Za-z])/g;
        while ((m = reDigits.exec(t))) if ((m[0].match(/[0-9]/g) || []).length >= 7 && !/\n/.test(m[0])) add(si, m.index, m.index + m[0].length, /^0/.test(m[0]) ? { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone - 3 } : { cat: 'number', rep: '【號碼】', pri: PRIORITY.number - 7 });
        const reIdN = /(?<![A-Za-z0-9])[A-Z][12?][0-9?OoIl|]{8}(?![0-9])/g;
        while ((m = reIdN.exec(t))) if ((m[0].match(/[0-9]/g) || []).length >= 7) add(si, m.index, m.index + 10, { cat: 'idno', rep: '【身分證號】', pri: PRIORITY.idno - 1 });
      }
      const reLong = /(?<![0-9A-Za-z])\d{8,}(?![0-9A-Za-z])/g;
      while ((m = reLong.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'number', rep: '【編號】', pri: PRIORITY.number - 5 });

      // 日期
      const isBirthCtx = (s, e) => /(出生|生日|生於|DOB|dob|出生日期|出生年月日|生\s*日)[^\n]{0,6}$/.test(t.slice(Math.max(0, s - 12), s)) || /^\s*(生|出生)/.test(t.slice(e, e + 3));
      const reDate = /(?<![0-9])(民國\s*)?([0-9０-９]{2,4})\s*(?:年|\/|-|\.)\s*([0-9０-９]{1,2})\s*(?:月|\/|-|\.)\s*([0-9０-９]{1,2})(?:\s*日|號)?(?![0-9])/g;
      while ((m = reDate.exec(t))) {
        const dt = mkDate(toHalf(m[2]), toHalf(m[3]), toHalf(m[4]));
        if (!dt) continue;
        const s = m.index, e = m.index + m[0].length;
        const isB = isBirthCtx(s, e) || (refDate - dt) / DAY > 365.25 * 40;   // 40 年以前的日期幾乎一定是生日
        add(si, s, e, { cat: isB ? 'birth' : 'date', date: dt, pri: isB ? PRIORITY.birth : PRIORITY.date });
      }
      const reCompact = /(?<![0-9])((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?![0-9])/g;
      while ((m = reCompact.exec(t))) {
        const dt = mkDate(m[1], m[2], m[3]); if (!dt) continue;
        const s = m.index, e = s + 8;
        const isB = isBirthCtx(s, e) || (refDate - dt) / DAY > 365.25 * 40;
        add(si, s, e, { cat: isB ? 'birth' : 'date', date: dt, pri: (isB ? PRIORITY.birth : PRIORITY.date) + 15 });
      }
      const reRoc7 = /(?<![0-9])(0\d{2}|1[01]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?![0-9])/g;
      while ((m = reRoc7.exec(t))) {
        const s = m.index, e = s + 7;
        if (!/(出生|生日|日期|DOB)[^\n]{0,4}$/.test(t.slice(Math.max(0, s - 8), s))) continue;
        const dt = mkDate(m[1], m[2], m[3]); if (!dt) continue;
        add(si, s, e, { cat: isBirthCtx(s, e) ? 'birth' : 'date', date: dt, pri: PRIORITY.birth + 15 });
      }
      // 中文數字日期（民國三十四年三月五日）
      const reCnDate = /(民國\s*)?([〇零一二三四五六七八九十百]{1,5})\s*年\s*([一二三四五六七八九十]{1,3})\s*月\s*([一二三四五六七八九十]{1,3})\s*[日號]/g;
      while ((m = reCnDate.exec(t))) {
        const dt = mkDate(cnNum(m[2]), cnNum(m[3]), cnNum(m[4])); if (!dt) continue;
        const s0 = m.index, e0 = s0 + m[0].length, isB = isBirthCtx(s0, e0) || (refDate - dt) / DAY > 365.25 * 40;
        add(si, s0, e0, { cat: isB ? 'birth' : 'date', date: dt, pri: isB ? PRIORITY.birth : PRIORITY.date });
      }
      // 出生年（民國34年生）
      const reBY = /(?<![0-9])(民國\s*)?([0-9０-９]{2,4})\s*年(?:\s*([0-9０-９]{1,2})\s*月)?\s*(?:生|出生)/g;
      while ((m = reBY.exec(t))) {
        const dt = mkDate(toHalf(m[2]), m[3] ? toHalf(m[3]) : 7, 1); if (!dt) continue;
        add(si, m.index, m.index + m[0].length - (/出生$/.test(m[0]) ? 2 : 1), { cat: 'birth', date: dt, pri: PRIORITY.birth - 1 });
      }

      // 地址
      // PDF 常在數字和中文之間插空白、在地址中間換行，這裡都容許
      const NUM = `[${NUMC}]+[ \\t\\u3000]?`;
      const TOK0 = `(?:[${CJK}]{1,3}[村里](?![程民長])|${NUM}鄰|[${CJK}]{1,6}?(?:路|街|大道)|${NUM}段|${NUM}巷|${NUM}弄|${NUM}(?:號|号)|(?:之|-|－)[ \\t]?${NUM}|${NUM}(?:樓|F|f)|地下${NUM}樓|B${NUM}|${NUM}室)`;
      const TOK = `(?:[ \\t\\u3000]*\\n){0,2}[ \\t\\u3000]*${TOK0}`;
      const CITY = `(?:${CITIES.join('|')})`;
      const DIST = `[${CJK}]{1,3}?[鄉鎮市區]`;
      const reAddr = new RegExp(`(${CITY})?(${DIST})?(${TOK0}(?:${TOK})*)`, 'g');
      const reCityAt = new RegExp(`^(${CITY})`);
      const reTokAll = new RegExp(`^(?:${TOK})+$`);
      while ((m = reAddr.exec(t))) {
        let s = m.index, full = m[0];
        if (!/[號号]|[村里]|鄰/.test(full)) continue;               // 要有門牌或村里
        // 縣市若在中段出現（如「同住在新北市…」）→ 從縣市開始
        const ci = CITIES.map(c => full.indexOf(c)).filter(k => k > 0 && k <= 8);
        if (ci.length) { const k = Math.min(...ci); s += k; full = full.slice(k); }
        const lead = ['居住於', '居住在', '住在', '住於', '位於', '搬到', '搬至', '遷至', '遷入', '戶籍', '地址', '住址', '通訊', '現居',
          '居住', '前往', '回到', '返回', '參加', '加入', '於', '在', '住', '到', '至', '往', '去', '為', '是', '的'];
        let changed = true;
        while (changed) { changed = false; for (const l of lead) if (full.startsWith(l) && full.length > l.length + 3) { full = full.slice(l.length); s += l.length; changed = true; } }
        let city = '', dist = '', rest = full;
        const cm = reCityAt.exec(rest);
        if (cm) { city = cm[1]; rest = rest.slice(city.length); }
        const dm = (city ? new RegExp(`^([${CJK}]{1,3}?[鄉鎮市區])`) : new RegExp(`^([${CJK}]{0,3}?)([${CJK}]{2}[鄉鎮市區])`)).exec(rest);
        if (dm) {
          const junk = city ? '' : dm[1];
          const d = city ? dm[1] : dm[2];
          const after = rest.slice(junk.length + d.length);
          if (after && reTokAll.test(after)) { s += junk.length; dist = d; rest = after; }
        }
        if (!city && !dist && !/[號号]/.test(rest)) continue;
        if (!reTokAll.test(rest)) continue;
        const keep = opt.addrLevel === 'district' ? city + dist : opt.addrLevel === 'city' ? city : '';
        const e = s + city.length + dist.length + rest.length;
        add(si, s, e, { cat: 'address', rep: keep + '【地址】', keepLen: keep.length, pri: PRIORITY.address });
      }

      // 人名：標籤＋姓名
      for (let i = 0; i < t.length; i++) {
        const rb = roleBefore(t, i);
        if (!rb) continue;
        const lat = (i === 0 || !/[A-Za-z]/.test(t[i - 1])) && new RegExp(`^${LATIN_NAME}`).exec(t.slice(i));
        if (lat && !lat[0].split(/\s+/).every(w => MED_LATIN_ALLOW.has(w) || EN_STOPWORDS.has(w))) {
          notePerson(lat[0], rb.role, si, i);
          // 「Nguyen Thi Lan（阮氏蘭）」「Amy 陳」→ 中文名也算同一人
          const tail = t.slice(i + lat[0].length);
          // 「Amy 陳（陳美玲）」「Nguyen Thi Lan（阮氏蘭）」：英文名後面的中文姓、括號裡的中文全名
          const zm = /^\s*(?:([\u4e00-\u9fff])(?=\s*[（(，,\s]|$))?\s*(?:[（(]\s*([\u4e00-\u9fff]{2,4})\s*[）)])?/.exec(tail);
          for (const zh of [zm && zm[1], zm && zm[2]]) if (zh && SURNAME_SET.has(zh[0]) && !/[籍國人語裔]$|看護|子|女|配偶|太太|先生|媽|爸/.test(zh) && !NOT_NAMES.has(zh)) cjkAlias.set(zh, lat[0]);
          continue;
        }
        if (rb.role === '看護') {
          if (isCJK(t[i]) && !NAME_STOP.has(t[i])) {
            let j = i; while (j < t.length && j - i < 3 && isCJK(t[j]) && !NAME_STOP.has(t[j]) && !titleAt(t, j)) j++;
            if (j - i >= 2) notePerson(t.slice(i, j), '看護', si, i);
          }
          continue;
        }
        // 暱稱只認典型形式（小美、阿妮、玲玲）；「長者、個案、案主」在量表裡是一般名詞，後面的字不猜
        const nk0 = t.substr(i, 2);
        const nickShape = /^[小阿老]./.test(nk0) || nk0[0] === nk0[1];
        if (rb.role !== '個案' && nickShape && !surnameAt(t, i) && isCJK(t[i]) && isCJK(t[i + 1]) && !NAME_STOP.has(t[i + 1]) &&
            (!isCJK(t[i + 2]) || NAME_STOP.has(t[i + 2]) || FOLLOW.test(t.slice(i + 2))) && !COMMON_WORDS.has(nk0) && !/^(小時|小便|小心|小姐|小組|小學|小腿|小孩|老人|老師|老化|阿公|阿嬤|阿伯|阿姨|阿媽)$/.test(nk0)) {
          const nk = nk0;
          if (!persons.has(nk)) add(si, i, i + 2, { cat: 'name', key: 'nick2:' + nk, rep: '【人名】', pri: PRIORITY.suggest, suggest: true, why: `接在「${rb.label}」後面，可能是暱稱` });
        }
        const nm = takeName(t, i);
        // 曾、連、何…也是常用虛詞：沒有冒號或空白分隔時不採用
        if (nm && AMBIG_SURNAME.has(nm[0]) && !/[\s:：]/.test(t[i - 1] || '')) continue;
        if (nm && nm.length >= 2) notePerson(nm, rb.role, si, i);
      }
      // 沒有欄位名稱的人名：句首／標點後，「冠夫姓四字」或「姓名＋稱謂、年齡、表示…」
      const STRONG = /^([（(]\s*\d{2,3}\s*歲|表示|自述|主訴|提到|說|認為|覺得|希望|同意|拒絕|喜歡|參與|參加|今天|今日|近期|近日|於本|本身)/;
      for (let i = 0; i < t.length; i++) {
        const prev = t[i - 1];
        if (i > 0 && isCJK(prev) && !NAME_STOP.has(prev) && !roleBefore(t, i)) continue;
        if (!COMMON_SURNAME.has(t[i])) continue;
        const two = SURNAME_SET.has(t[i + 1]);   // 冠夫姓：第二個字也是姓（含較少見的姓，如詹嚴麗珠）
        for (const len of two ? [4, 3] : [3]) {
          const nm = t.substr(i, len);
          if (nm.length < len || [...nm.slice(1)].some(c => !isCJK(c) || NAME_STOP.has(c)) || NOT_NAMES.has(nm) || NOT_NAMES.has(nm.slice(0, 2))) continue;
          if (PLACE_END.has(nm[len - 1]) || FOLLOW.test(nm.slice(len - 1)) || titleAt(t, i + 1) || titleAt(t, i + len - 1)) continue;
          const rest = t.slice(i + len), nx = rest[0];
          const strong = !!titleAt(t, i + len) || STRONG.test(rest);
          const boundary = !nx || !isCJK(nx) || NAME_STOP.has(nx) || FOLLOW.test(rest);
          if (strong || (len === 4 && two && boundary)) { notePerson(nm, (roleBefore(t, i) || {}).role || null, si, i); break; }
        }
      }
      // 全名＋職稱（王大明醫師、陳美華女士）
      for (let i = 0; i < t.length; i++) {
        const sl = surnameAt(t, i); if (!sl) continue;
        if (i > 0 && isCJK(t[i - 1]) && !roleBefore(t, i) && SURNAME_SET.has(t[i - 1])) continue;
        for (const gl of (sl === 1 && SURNAME_SET.has(t[i + 1]) ? [3, 2, 1] : [2, 1])) {
          const g = t.substr(i + sl, gl);
          if (g.length < gl || [...g].some(c => !isCJK(c) || NAME_STOP.has(c))) continue;
          const ti = titleAt(t, i + sl + gl, FULLNAME_TITLES);
          if (ti) {
            const nm = t.substr(i, sl + gl);
            if (!NOT_NAMES.has(nm)) notePerson(nm, STAFF_TITLES.has(ti) ? '人員' : (roleBefore(t, i) || {}).role || null, si, i);
            break;
          }
        }
      }
      // ── 英文表單 ──
      // 英文欄位＋姓名（Patient Name: John Smith、Emergency Contact: Mary Smith）
      for (const [role, labs] of EN_LABELS) for (const lab of labs) {
        const re = new RegExp(`(?<![A-Za-z])${lab.replace(/[a-z]/gi, c => `[${c.toUpperCase()}${c.toLowerCase()}]`).replace(/ /g, '\\s+')}\\s*(?:[:：#\\-]\\s*|\\s+)((?:(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\\.?\\s+)?)(${LATIN_NAME})`, 'g');
        while ((m = re.exec(t))) {
          const nm = m[2];
          if (nm.split(/\s+/).every(w => EN_STOPWORDS.has(w) || MED_LATIN_ALLOW.has(w))) continue;
          notePerson(nm, /^(Dr|Prof)/.test(m[1]) ? '人員' : role, si, m.index);
        }
      }
      // 稱呼（Mr. Smith、Mrs Margaret O'Brien、Dr. Patel）
      const reHon = new RegExp(`(?<![A-Za-z])(Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\\.?\\s+(${LATIN_NAME})`, 'g');
      while ((m = reHon.exec(t))) if (!m[2].split(/\s+/).every(w => MED_LATIN_ALLOW.has(w) || EN_STOPWORDS.has(w))) notePerson(m[2], /^(Dr|Prof)$/.test(m[1]) ? '人員' : null, si, m.index);
      // 親屬稱謂＋名字（his daughter Susan、caregiver Ani）
      KIN_EN.lastIndex = 0;
      while ((m = KIN_EN.exec(t))) {
        const nm = new RegExp(`^${NAME_WORD}(?:\\s+${NAME_WORD})?`).exec(t.slice(m.index + m[0].length));
        if (!nm || nm[0].split(/\s+/).every(w => MED_LATIN_ALLOW.has(w) || EN_STOPWORDS.has(w))) continue;
        const kin = m[1].toLowerCase();
        notePerson(nm[0], /caregiver|carer|helper/.test(kin) ? '看護' : /nurse|therapist|doctor|physician|social/.test(kin) ? '人員' : /friend|neighbo/.test(kin) ? null : '家屬', si, m.index);
      }
      // 電話：國際碼、美式、英式
      const rePhoneEn = /(?<![\w+])(?:\+\d{1,3}[\s\-]?\(?\d{1,4}\)?(?:[\s\-.]?\d{2,4}){2,4}|\(\d{3}\)\s?\d{3}[\s\-.]\d{4}|\d{3}[\-.]\d{3}[\-.]\d{4}|0\d{4}\s\d{6}|0\d{2,3}\s\d{3,4}\s\d{4})(?![\w])/g;
      while ((m = rePhoneEn.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'phone', rep: '【電話】', pri: PRIORITY.phone });
      // 證號：SSN、NHS、病歷號、護照、保險
      const reSSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g;
      while ((m = reSSN.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'idno', rep: '【身分證號】', pri: PRIORITY.idno });
      const reIdEn = /(MRN|Medical Record(?:\s+(?:Number|No\.?))?|Patient ID|Client ID|Resident ID|NHS\s+(?:Number|No\.?)|Social Security(?:\s+Number)?|SSN|Passport(?:\s+(?:Number|No\.?))?|NIK|KTP|ARC(?:\s+No\.?)?|Resident Permit(?:\s+No\.?)?|Insurance(?:\s+(?:Number|No\.?|ID))?|Policy(?:\s+(?:Number|No\.?))?|Medicare(?:\s+(?:Number|No\.?))?|Medicaid(?:\s+(?:Number|ID))?|Member ID|Case\s+(?:Number|No\.?|ID)|ID\s+(?:Number|No\.?))\s*[:#]?\s*([A-Z0-9][A-Z0-9\- ]{3,22}[A-Z0-9])/gi;
      while ((m = reIdEn.exec(t))) { const v = m[2].replace(/\s+[A-Za-z].*$/, ''); const st = m.index + m[0].length - m[2].length; add(si, st, st + v.length, { cat: 'number', rep: '【編號】', pri: PRIORITY.phone + 2 }); }
      // 日期：03/15/1940、21 June 1938、March 3, 2024
      const birthEn = (st) => /(DOB|D\.O\.B\.?|Date of Birth|Birth\s*date|Birthday|Born(?:\s+on)?)\s*[:：]?\s*$/i.test(t.slice(Math.max(0, st - 20), st));
      const addDateEn = (st, en, dt) => { if (!dt) return; const isB = birthEn(st) || isBirthCtx(st, en) || (refDate - dt) / DAY > 365.25 * 40; add(si, st, en, { cat: isB ? 'birth' : 'date', date: dt, pri: isB ? PRIORITY.birth : PRIORITY.date }); };
      const reDmy = /(?<![\d\/])(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})(?![\d\/])/g;
      while ((m = reDmy.exec(t))) { let a1 = +m[1], a2 = +m[2]; const [mo, d] = a1 > 12 ? [a2, a1] : [a1, a2]; addDateEn(m.index, m.index + m[0].length, mkDate(m[3], mo, d)); }
      const reDMonY = new RegExp(`(?<![\\w])(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+((?:19|20)\\d{2})(?!\\d)`, 'gi');
      while ((m = reDMonY.exec(t))) addDateEn(m.index, m.index + m[0].length, mkDate(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]));
      const reMonDY = new RegExp(`(?<![\\w])${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})(?!\\d)`, 'gi');
      while ((m = reMonDY.exec(t))) addDateEn(m.index, m.index + m[0].length, mkDate(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]));
      // 地址：Address: 一整行；門牌＋街名；郵遞區號；印尼 Jl.
      const reAddrLab = /(?<![A-Za-z])(?:Home\s+|Residential\s+|Mailing\s+|Current\s+|Permanent\s+)?Address\s*[:：]\s*([^\n]{4,})/gi;
      while ((m = reAddrLab.exec(t))) { const st = m.index + m[0].length - m[1].length; add(si, st, st + m[1].replace(/\s+$/, '').length, { cat: 'address', rep: '【地址】', pri: PRIORITY.address + 3 }); }
      const reStreet = /(?<![\w])\d{1,6}[A-Za-z]?\s+(?:[A-Z][a-zA-Z'’\-]*\s+){0,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Close|Crescent|Highway|Hwy|Parkway|Pkwy|Square|Sq|Gardens|Grove|Row|Walk|Hill)\b\.?(?:,?\s*(?:Apt|Apartment|Unit|Suite|Ste|Flat|Fl|Floor|#)\.?\s*[A-Za-z0-9\-]+)?(?:,\s*[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})?(?:,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?(?:,?\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})?/g;
      while ((m = reStreet.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'address', rep: '【地址】', pri: PRIORITY.address + 2 });
      const rePost = /(?<![A-Za-z\d])(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2})(?![A-Za-z\d])/g;
      while ((m = rePost.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'address', rep: '【地址】', pri: PRIORITY.address + 1 });
      const reJl = /(?<![A-Za-z])(?:Jl|Jalan|Gg|Gang)\.?\s+[A-Z][^\n,，]{1,40}?(?:No\.?\s*\d+[A-Za-z]?)(?:\s*,?\s*RT\s*\d+\s*\/?\s*RW\s*\d+)?/g;
      while ((m = reJl.exec(t))) add(si, m.index, m.index + m[0].length, { cat: 'address', rep: '【地址】', pri: PRIORITY.address + 2 });
      // 英文機構名稱
      const reOrgEn = /(?<![A-Za-z])(?:[A-Z][a-zA-Z'’&\-]+\s+){1,5}(?:Hospital|Medical\s+Cent(?:er|re)|Clinic|Nursing\s+Home|Care\s+Home|Health\s+Cent(?:er|re)|Rehabilitation\s+Cent(?:er|re)|Rehab\s+Cent(?:er|re)|Hospice|Day\s+Cent(?:er|re)|Senior\s+Cent(?:er|re)|Home\s+Care|Healthcare|Health\s+System|Foundation|Association)\b/g;
      while ((m = reOrgEn.exec(t))) { const v = m[0].replace(/^(?:At|The|In|To|From|Of|And|By|On)\s+/, ''); const st = m.index + m[0].length - v.length; add(si, st, st + v.length, { cat: 'org', key: v, orgType: /Hospital|Clinic|Medical/.test(v) ? '醫院' : '機構', pri: PRIORITY.org }); }

      // 外籍看護英文名（低信心，建議）
      const reLat = /(?<![A-Za-z])[A-Z][a-z]{2,}(?:\s[A-Z][a-z]+){0,3}(?![A-Za-z])/g;
      while ((m = reLat.exec(t))) {
        const words = m[0].split(/\s/);
        if (words.every(w => MED_LATIN_ALLOW.has(w))) continue;
        if (persons.has(m[0])) continue;
        // 英文單字大多不是人名：只有附近提到看護、外籍、移工、國籍時才問
        if (/^[\-:：]/.test(t.slice(m.index + m[0].length))) continue;   // Live-in、Note: 不是人名
        const near = t.slice(Math.max(0, m.index - 14), m.index + m[0].length + 14);
        if (!/看護|外看|外籍|移工|印傭|菲傭|越傭|幫傭|印尼|菲律賓|越南|泰國|caregiver|helper/i.test(near)) continue;
        add(si, m.index, m.index + m[0].length, { cat: 'name', key: 'latin:' + m[0], rep: '【人名】', pri: PRIORITY.latin, suggest: true, why: '英文名字（可能是外籍看護）' });
      }
      // 「某某表示／說」（低信心）
      const reSay = new RegExp(`([${CJK}]{2,4})(?=表示|說(?![明話服法過出成])|提到|告知|自述|主訴|回應|反應|抱怨|同意|拒絕|希望|擔心)`, 'g');
      while ((m = reSay.exec(t))) {
        for (let k = 0; k < m[1].length - 1; k++) {
          const nm = takeName(m[1], k);
          if (nm && k + nm.length === m[1].length && nm.length >= 2) {
            const s = m.index + k;
            if (!persons.has(nm)) add(si, s, s + nm.length, { cat: 'name', key: 'say:' + nm, rep: '【人名】', pri: PRIORITY.suggest, suggest: true, why: '出現在「表示／說」前面，可能是人名' });
            break;
          }
        }
      }
      // 機構
      const reOrg = new RegExp(`[^\\s，。、；：:（）()「」『』,.;!?！？0-9…‧·．—–~～\\-]{1,14}?(?:${ORG_SUFFIX.join('|')})`, 'g');
      while ((m = reOrg.exec(t))) {
        const suf = ORG_SUFFIX.find(x => m[0].endsWith(x));
        let pre = m[0].slice(0, m[0].length - suf.length);
        let s = m.index;
        let cut = 0;
        for (const b of ORG_BOUNDARY) { const k = pre.lastIndexOf(b); if (k >= 0 && k + b.length > cut) cut = k + b.length; }
        pre = pre.slice(cut); s += cut;
        if (pre.length < 2 || ORG_GENERIC.has(pre) || (pre.length <= 2 && /[家間個]$/.test(pre))) continue;
        if (allow.has(pre + suf)) continue;
        add(si, s, s + pre.length + suf.length, { cat: 'org', key: pre + suf, orgType: /醫院|診所|醫學中心|分院/.test(suf) ? '醫院' : '機構', pri: PRIORITY.org });
      }
    });

    // 冠夫姓：若只抓到前三字（張徐金），但全文出現「張徐金蓮」→ 改用四字
    for (const p of [...persons.keys()]) {
      if (p.length !== 3 || !SURNAME_SET.has(p[0]) || !SURNAME_SET.has(p[1])) continue;
      const cnt = new Map();
      for (const t of segments) { let k = -1; while ((k = t.indexOf(p, k + 1)) >= 0) { const x = t[k + 3]; if (isCJK(x) && !NAME_STOP.has(x) && !titleAt(t, k + 3) && !FOLLOW.test(t.slice(k + 3)) && !PLACE_END.has(x)) cnt.set(x, (cnt.get(x) || 0) + 1); } }
      const best = [...cnt].sort((a, b) => b[1] - a[1])[0];
      if (best && !NOT_NAMES.has(p + best[0])) {
        const full = p + best[0], pp = persons.get(p);
        if (!persons.has(full)) persons.set(full, pp); else { const q = persons.get(full); q.first = Math.min(q.first, pp.first); if (!q.role) q.role = pp.role; }
        persons.delete(p);
      }
    }
    // 英文名：拆成單字（John Michael Smith → John、Michael、Smith），只屬於一個人的單字也一起遮
    const alias = new Map();
    const isLat = n => /^[A-Za-z]/.test(n);
    const words = n => n.split(/\s+/).filter(w => /^[A-Z]/.test(w) && w.replace(/[.'’\-]/g, '').length >= 2 && !MED_LATIN_ALLOW.has(w) && !EN_STOPWORDS.has(w));
    const owners = new Map();
    for (const n of persons.keys()) if (isLat(n) && words(n).length >= 2) for (const w of words(n)) { if (!owners.has(w)) owners.set(w, new Set()); owners.get(w).add(n); }
    // 單字名併入全名（Dewi → Dewi Lestari；Smith 若同時屬於兩個人就不併）
    for (const a of [...persons.keys()]) {
      if (!isLat(a)) continue;
      const own = words(a).length === 1 && owners.get(words(a)[0]);
      const b = own && own.size === 1 ? [...own][0] : [...persons.keys()].find(x => x !== a && x.startsWith(a + ' '));
      if (b && b !== a && persons.has(b)) {
        const pa = persons.get(a), pb = persons.get(b);
        pb.first = Math.min(pa.first, pb.first); if (!pb.role) pb.role = pa.role;
        alias.set(a, b); persons.delete(a);
      }
    }
    for (const [w, own] of owners) if (own.size === 1 && !persons.has(w) && !alias.has(w)) alias.set(w, [...own][0]);
    for (const [zh, full] of cjkAlias) if (persons.has(full) || alias.has(full)) alias.set(zh, alias.get(full) || full);
    // 同名不同姓（王大明 vs 陳大明）：別的姓＋相同名字，是另一個人，不能被「大明」縮寫吃掉
    {
      const giv = new Map();
      for (const nm of persons.keys()) if (nm.length === 3 && !/^[A-Za-z]/.test(nm) && !SURNAME_COMPOUND.some(c => nm.startsWith(c))) giv.set(nm.slice(1), nm[0]);
      segments.forEach((t, si) => {
        for (const [g, sur] of giv) {
          let k = 0;
          while ((k = t.indexOf(g, k + 1)) > 0) {
            const c = t[k - 1], b = t[k - 2];
            if (c === sur || !SURNAME_SET.has(c) || persons.has(c + g)) continue;
            if (k >= 2 && isCJK(b) && !roleBefore(t, k - 1) && !/[、與和及跟同]/.test(b)) continue;
            notePerson(c + g, (roleBefore(t, k - 1) || {}).role || null, si, k - 1);
          }
        }
      });
    }
    // Pass 2：已知人名擴散到全文（含名字縮寫）
    const personList = [...persons.keys()].sort((a, b) => b.length - a.length);
    const givenMap = new Map(), maidenMap = new Map();
    for (const nm of personList) {
      if (/^[A-Za-z]/.test(nm)) continue;
      const sl = SURNAME_COMPOUND.some(c => nm.startsWith(c)) ? 2 : 1;
      const given = nm.length === 4 && sl === 1 ? nm.slice(2) : nm.slice(sl);   // 冠夫姓取最後兩字
      if (given.length === 2 && !givenMap.has(given)) givenMap.set(given, nm);
      if (nm.length === 4 && sl === 1 && !persons.has(nm.slice(1))) maidenMap.set(nm.slice(1), nm);   // 吳林玉英 → 林玉英
    }
    segments.forEach((t, si) => {
      for (const [short, full] of alias) {
        if (!persons.has(full)) continue;
        const re = new RegExp(/^[A-Za-z]/.test(short) ? `(?<![A-Za-z])${esc(short)}(?![A-Za-z])` : esc(short), 'g'); let mm;
        while ((mm = re.exec(t))) add(si, mm.index, mm.index + short.length, { cat: 'name', key: full, person: full, pri: PRIORITY.name });
      }
      for (const nm of personList) {
        if (/^[A-Za-z]/.test(nm)) {
          // 英文名：連同後面的姓一起（Dewi → Dewi Lestari）
          const re = new RegExp(`(?<![A-Za-z])${esc(nm)}(?:[\\s_.\\-]{1,2}[A-Z][a-z]+){0,3}(?![A-Za-z])`, 'g'); let mm;
          while ((mm = re.exec(t))) add(si, mm.index, mm.index + mm[0].length, { cat: 'name', key: nm, person: nm, pri: PRIORITY.name + 1 });
          continue;
        }
        let k = -1;
        while ((k = t.indexOf(nm, k + 1)) >= 0) {
          add(si, k, k + nm.length, { cat: 'name', key: nm, person: nm, pri: PRIORITY.name });
          const pp = persons.get(nm); if (si * 1e7 + k < pp.first) pp.first = si * 1e7 + k;
        }
      }
      for (const [v, nm] of maidenMap) {
        let k = -1;
        while ((k = t.indexOf(v, k + 1)) >= 0) add(si, k, k + 3, { cat: 'name', key: nm, person: nm, pri: PRIORITY.name });
      }
      for (const [g, nm] of givenMap) {
        let k = -1;
        while ((k = t.indexOf(g, k + 1)) >= 0) {
          if (/[路街巷段里村區鄉鎮市號]/.test(t[k + 2] || '')) continue;
          add(si, k, k + 2, { cat: 'name', key: nm, person: nm, pri: PRIORITY.name - 1 });
        }
      }
      // 姓＋稱謂（王伯伯、陳醫師）、阿X姨
      for (let i = 0; i < t.length; i++) {
        const sl = surnameAt(t, i); if (!sl) continue;
        const ti = titleAt(t, i + sl); if (!ti) continue;
        if (i > 0 && SURNAME_SET.has(t[i - 1]) && isCJK(t[i - 1])) {
          // 前一字也是姓 → 可能是全名的一部分（如「王小明先生」的「明先生」），交給全名規則
        }
        const prev = t[i - 1];
        if (prev && isCJK(prev) && !roleBefore(t, i) && !/[和與跟及、的找問請給叫向對被讓]/.test(prev)) {
          // 「高血壓阿嬤」等：前面是一般中文就不視為姓
          if (!(ti.length >= 2)) continue;
        }
        const sur = t.substr(i, sl);
        const key = sur + ti;
        if (NOT_NAMES.has(key) || allow.has(key)) continue;
        titleKeys.push(key);
        add(si, i, i + sl, { cat: 'name', key: 'title:' + key, surname: sur, title: ti, role: (roleBefore(t, i) || {}).role || (STAFF_TITLES.has(ti) ? '人員' : null), pri: PRIORITY.title, firstPos: si * 1e7 + i });
      }
      const reNick = /阿([一-鿿])(姨|伯|嬤|嫂|姐|姊|哥|叔|婆|姑|嬸|妹|弟)/g;
      let m;
      while ((m = reNick.exec(t))) {
        if ('公嬤媽婆伯姨叔嬸爸母姐姊哥兄弟妹嫂姑舅祖爺奶伯'.includes(m[1])) continue;
        add(si, m.index, m.index + 2, { cat: 'name', key: 'nick:' + m[0].slice(0, 2), nick: m[0].slice(0, 2), title: m[2], pri: PRIORITY.title, firstPos: si * 1e7 + m.index });
      }
    });

    // 強制（Excel 欄位）
    for (const f of opt.forced) add(f.seg, f.start, f.end, Object.assign({ pri: 200, forced: true }, f));

    // 去掉不遮蔽詞、解決重疊
    const spansBySeg = cands.map((list, si) => {
      const t = segments[si];
      list = list.filter(c => !allow.has(t.slice(c.s, c.e)));
      list.sort((a, b) => b.pri - a.pri || (b.e - b.s) - (a.e - a.s) || a.s - b.s);
      const taken = [];
      const out = [];
      for (const c of list) {
        if (taken.some(([s, e]) => c.s < e && c.e > s)) continue;
        taken.push([c.s, c.e]); out.push(c);
      }
      return out.sort((a, b) => a.s - b.s);
    });

    // 代號：人員依首次出現排序
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const letterOf = i => i < 26 ? LETTERS[i] : LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26];
    const usedPersons = new Set();
    spansBySeg.forEach(list => list.forEach(c => { if (c.person) usedPersons.add(c.person); }));
    const plist = [...usedPersons].sort((a, b) => persons.get(a).first - persons.get(b).first);
    const pcode = new Map();
    plist.forEach((nm, i) => pcode.set(nm, { letter: letterOf(i), role: persons.get(nm).role || '關係人' }));
    let nextLetter = plist.length;
    const surnameOwners = new Map();
    for (const nm of plist) {
      if (/^[A-Za-z]/.test(nm)) continue;
      const sl = SURNAME_COMPOUND.some(c => nm.startsWith(c)) ? 2 : 1;
      const sur = nm.slice(0, sl);
      if (!surnameOwners.has(sur)) surnameOwners.set(sur, []);
      surnameOwners.get(sur).push(nm);
    }
    // 稱謂實體：同姓且只有一位已知人物 → 用同一字母
    const titleLetter = new Map();
    const titleCands = [];
    spansBySeg.forEach(list => list.forEach(c => { if (c.key && (c.key.startsWith('title:') || c.key.startsWith('nick:'))) titleCands.push(c); }));
    titleCands.sort((a, b) => a.firstPos - b.firstPos);
    for (const c of titleCands) {
      if (titleLetter.has(c.key)) continue;
      let letter = null;
      if (c.surname) {
        const owners = surnameOwners.get(c.surname) || [];
        if (owners.length === 1) letter = pcode.get(owners[0]).letter;
      }
      if (!letter) letter = letterOf(nextLetter++);
      titleLetter.set(c.key, letter);
    }

    // 日期：服務日期的第一天
    let day0 = null;
    spansBySeg.forEach(list => list.forEach(c => { if (c.cat === 'date' && c.date && (!day0 || c.date < day0)) day0 = c.date; }));

    // 機構代號
    const orgCode = new Map(); const orgCount = { 醫院: 0, 機構: 0 };
    spansBySeg.forEach(list => list.forEach(c => {
      if (c.cat === 'org' && !orgCode.has(c.key)) orgCode.set(c.key, c.orgType + letterOf(orgCount[c.orgType]++));
    }));

    // 建實體
    const entities = new Map();
    const spans = spansBySeg.map((list, si) => list.map(c => {
      const t = segments[si];
      const orig = t.slice(c.s, c.e);
      let id, rep = c.rep, cat = c.cat, conf = c.suggest ? 'suggest' : 'high', extra = {};
      if (c.forced) { id = 'forced:' + c.cat + ':' + orig; extra.forced = true; }
      else if (c.person) {
        extra.fullName = c.person;
        const pc = pcode.get(c.person);
        id = 'name:' + c.person; rep = pc.role + pc.letter; extra.role = pc.role; extra.letter = pc.letter;
      } else if (c.key && (c.key.startsWith('title:') || c.key.startsWith('nick:'))) {
        id = 'name:' + c.key; rep = titleLetter.get(c.key);
      } else if (c.cat === 'birth') {
        id = 'birth:' + orig; rep = ageBand(c.date, refDate, opt.ageBand);
      } else if (c.cat === 'date') {
        id = 'date:' + orig;
        if (opt.dateMode === 'keep') { return null; }
        rep = opt.dateMode === 'yearmonth' ? `${c.date.getUTCFullYear()}年${c.date.getUTCMonth() + 1}月` : `第${Math.round((c.date - day0) / DAY) + 1}天`;
      } else if (c.cat === 'org') {
        id = 'org:' + c.key; rep = orgCode.get(c.key);
      } else {
        id = (c.key || c.cat) === c.cat ? c.cat + ':' + orig : c.cat + ':' + c.key;
      }
      let en = entities.get(id);
      if (!en) {
        en = Object.assign({ id, cat, label: (CAT_INFO[cat] || {}).label || cat, color: (CAT_INFO[cat] || {}).color || 'custom', original: orig, rep, conf, count: 0, why: c.why || '', variants: new Set() }, extra);
        entities.set(id, en);
      }
      en.count++; en.variants.add(orig);
      return { s: c.s, e: c.e, id, rep, keepLen: c.keepLen || 0 };
    }).filter(Boolean));

    // 姓名實體的顯示：用全名
    for (const en of entities.values()) if (en.fullName) en.original = en.fullName;

    // 以英文為主的文件：替換文字也用英文（Client A、[Phone]）
    let cjkN = 0, latN = 0;
    for (const t of segments) { cjkN += (t.match(/[\u4e00-\u9fff]/g) || []).length; latN += (t.match(/[A-Za-z]/g) || []).length; }
    const lang = latN >= 60 && cjkN <= latN * 0.1 ? 'en' : 'zh';
    if (lang === 'en') {
      for (const en of entities.values()) en.rep = localize(en.rep, 'en');
      for (const list of spans) for (const sp of list) { sp.rep = localize(sp.rep, 'en'); if (sp.keepLen) sp.keepLen = 0; }
    }

    return { entities, spans, day0, persons, lang };
  }

  const ROLE_EN = { 個案: 'Client', 家屬: 'Family', 看護: 'Caregiver', 人員: 'Staff', 關係人: 'Person', 人物: 'Person' };
  const TAG_EN = { 電話: 'Phone', 身分證號: 'ID', 編號: 'ID No.', 號碼: 'Number', Email: 'Email', 帳號: 'Account', 人名: 'Name', 已遮蔽: 'Redacted', 出生日期: 'DOB', 日期: 'Date', 地址: 'Address', '90歲以上': 'Age 90+' };
  function localize(rep, lang) {
    if (lang !== 'en' || rep == null) return rep;
    let m;
    if ((m = /^(個案|家屬|看護|人員|關係人|人物)([A-Z]{1,2})$/.exec(rep))) return ROLE_EN[m[1]] + ' ' + m[2];
    if ((m = /^(醫院|機構)([A-Z]{1,2})$/.exec(rep))) return (m[1] === '醫院' ? 'Hospital ' : 'Organization ') + m[2];
    if ((m = /^第(\d+)天$/.exec(rep))) return 'Day ' + m[1];
    if ((m = /^(\d{4})年(\d{1,2})月$/.exec(rep))) return m[1] + '-' + m[2].padStart(2, '0');
    if ((m = /^【(\d+)–(\d+)歲】$/.exec(rep))) return `[Age ${m[1]}-${m[2]}]`;
    return rep.replace(/.*【地址】$/, '[Address]').replace(/【([^】]+)】/g, (_, k) => '[' + (TAG_EN[k] || k) + ']');
  }
  // 啟用中的替換（含「個案王小明」→「個案A」去重）
  function resolve(text, spans, isOn) {
    const out = [];
    for (const sp of spans) {
      if (!isOn(sp.id)) continue;
      let rep = sp.rep;
      const m = /^(個案|家屬|看護|人員|關係人|人物)([A-Z]{1,2})$/.exec(rep) || /^(Client|Family|Caregiver|Staff|Person) ([A-Z]{1,2})$/.exec(rep);
      if (m && text.slice(Math.max(0, sp.s - m[1].length - 1), sp.s).replace(/\s$/, '').endsWith(m[1])) rep = m[2];
      // 自訂稱呼已含稱謂（A 阿嬤）、原文後面又接同一個稱謂（阿嬤）→ 不要重複
      const tt = /(阿嬤|阿公|奶奶|爺爺|伯伯|阿姨|叔叔|先生|女士|小姐|太太)$/.exec(rep);
      if (tt && text.startsWith(tt[1], sp.e)) rep = rep.slice(0, -tt[1].length).replace(/\s+$/, '');
      out.push({ s: sp.s, e: sp.e, rep, id: sp.id, keepLen: sp.keepLen });
    }
    return out;
  }
  function render(text, spans, isOn) {
    let out = '', p = 0;
    for (const r of resolve(text, spans, isOn)) { out += text.slice(p, r.s) + r.rep; p = r.e; }
    return out + text.slice(p);
  }
  function parseDate(str) {
    const m = /(?:民國\s*)?([0-9０-９]{2,4})\s*(?:年|\/|-|\.)\s*([0-9０-９]{1,2})\s*(?:月|\/|-|\.)\s*([0-9０-９]{1,2})/.exec(str || '');
    if (m) return mkDate(toHalf(m[1]), toHalf(m[2]), toHalf(m[3]));
    const c = /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec((str || '').trim());
    return c ? mkDate(c[1], c[2], c[3]) : null;
  }

  const api = { analyze, render, resolve, parseDate, ageBand, localize, CAT_INFO, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Deid = api;
})(typeof window !== 'undefined' ? window : globalThis);
