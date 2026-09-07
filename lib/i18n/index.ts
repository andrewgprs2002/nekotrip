export type Locale = 'en' | 'zh-TW';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'nekotrip_locale';

const zhTW: Record<string, string> = {
  "+ Create folder": "+ 建立資料夾",
  "Accept suggested order": "採用建議順序",
  "Account email": "帳號電子郵件",
  "Add": "加入",
  "Add collaborator": "加入協作者",
  "Add cost": "新增費用",
  "Add manually without map location": "手動新增（不於地圖上標記）",
  "Add place": "新增景點",
  "Add selected": "加入已選項目",
  "Add to Trip": "加入旅程",
  "Add to selection": "加入選取",
  "Add to wishlist": "加入願望清單",
  "Address unavailable": "無地址資訊",
  "All": "全部",
  "All places": "所有景點",
  "All saved places": "所有收藏景點",
  "Already paid": "已支付",
  "Animals": "動物",
  "Arrive by": "抵達期限",
  "Available only for linked Shared Wishlist places.": "僅適用於連結至共享願望清單的景點。",
  "Average": "平均",
  "Avg": "平均",
  "Avoid highways": "避開高速公路",
  "Avoid tolls": "避開收費道路",
  "Back": "上一步",
  "Build the itinerary": "開始安排旅程",
  "Cafe": "咖啡廳",
  "Calculating…": "計算中…",
  "Cancel": "取消",
  "Cancel delete": "取消刪除",
  "Cancel rename": "取消重新命名",
  "Category": "分類",
  "Change Trip dates?": "要變更旅程日期嗎？",
  "Changing departure also realigns the dates shown on Day 1, Day 2, and so on.": "變更出發日期後，第 1 天、第 2 天等行程日期也會自動重新對齊。",
  "Choose a day to calculate that day's route.": "選擇行程日期即可計算當日路線。",
  "Choose Trip…": "選擇旅程…",
  "Choose a day to draw its route. Reordering stops recalculates the route automatically.": "選擇一天即可繪製路線；調整停靠順序後會自動重新計算。",
  "Choose a day to see its route, travel time and distance. You can also set lodging endpoints and route preferences.": "選擇一天即可查看路線、車程與距離，也能設定住宿起終點及路線偏好。",
  "Choose a place card or marker.": "選擇景點卡片或地圖標記。",
  "Choose a saved place or map marker.": "選擇收藏景點或地圖標記。",
  "Choose existing Trip…": "選擇既有旅程…",
  "Clear": "清除",
  "Close": "關閉",
  "Close trip settings": "關閉旅程設定",
  "Collaborative": "協作模式",
  "Collaborative foundation is ready.": "協作基礎已就緒。",
  "Collaborator email (optional — only this user is added)": "協作者電子郵件（選填，只會加入此使用者）",
  "Collaborators": "協作者",
  "Confirm rename": "確認重新命名",
  "Consensus": "共識",
  "Consensus ranking": "共識排名",
  "Copy my current private folders, places, notes and ratings (snapshot)": "複製目前私人資料夾、景點、備註與評分（快照）",
  "Create Trip": "建立旅程",
  "Create Trip from selection": "從已選項目建立旅程",
  "Create a Shared Wishlist directly from My Wishlist. Only explicitly added members can access it.": "直接從「我的願望清單」建立共享願望清單，只有明確加入的成員能存取。",
  "Create a trip": "建立旅程",
  "Create shared copy": "建立共享副本",
  "Create trip": "建立旅程",
  "Create your first Trip": "建立你的第一趟旅程",
  "Creating…": "建立中…",
  "Credit": "多付",
  "Currency": "幣別",
  "Danger zone": "危險區域",
  "Dates TBD": "日期未定",
  "Day": "日期",
  "Day total": "當日總計",
  "Delete": "刪除",
  "Delete Shared Wishlist": "刪除共享願望清單",
  "Delete entire trip…": "刪除整趟旅程…",
  "Delete this message?": "要刪除這則留言嗎？",
  "Delete trip permanently": "永久刪除旅程",
  "Deleting a trip permanently removes its itinerary, days, memberships, invitations, preferences, and activity history.": "刪除旅程會永久移除行程、天數、成員、邀請、偏好設定與活動紀錄。",
  "Deleting this trip permanently removes its itinerary and memberships.": "刪除此旅程會永久移除行程內容與成員資料。",
  "Deleting…": "刪除中…",
  "Depart at": "出發時間",
  "Departure": "出發",
  "Departure date": "出發日期",
  "Departure date (optional)": "出發日期（選填）",
  "Distance": "距離",
  "Driving": "開車",
  "Edit cost": "編輯費用",
  "Edit departure and end date independently. Day 1, Day 2, and later calendar dates follow the departure date.": "可分別修改出發與結束日期；第 1 天、第 2 天及後續日期會依出發日期自動排列。",
  "Email": "電子郵件",
  "Email is shown only in explicit Members detail views.": "電子郵件只會顯示在明確開啟的成員詳細資訊中。",
  "Email me a verification code": "寄送驗證碼",
  "End": "結束",
  "End / lodging": "終點 / 住宿",
  "End date": "結束日期",
  "End date (optional)": "結束日期（選填）",
  "End date cannot be before departure date.": "結束日期不能早於出發日期。",
  "End date cannot be before start date.": "結束日期不能早於開始日期。",
  "Enter code": "輸入驗證碼",
  "Equal split": "平均分攤",
  "Estimated arrival": "推算抵達",
  "Estimated departure": "推算出發",
  "Expense details": "費用明細",
  "Expense saved.": "費用已儲存。",
  "Filter by day, move places between days, set stay time, and change the stop order.": "依日期篩選、移動景點、設定停留時間並調整順序。",
  "Folder": "資料夾",
  "Folder order": "資料夾順序",
  "Folders": "資料夾",
  "Food": "美食",
  "Give the trip a name and optional travel dates. You can adjust the dates later.": "先替旅程命名，也可以設定旅遊日期；之後仍可修改。",
  "Google Maps is wired. Add Supabase credentials to unlock accounts, persistent trips, invitations, and realtime editing.": "Google Maps 已連接。加入 Supabase 憑證後即可啟用帳號、永久保存旅程、邀請與即時協作。",
  "Google Places results": "Google Places 搜尋結果",
  "Got it": "知道了",
  "Hotel": "飯店",
  "Hotel endpoints, schedule and driving preferences are saved per day.": "住宿起終點、時間與駕駛偏好會依每天分別儲存。",
  "Invite your travel partners": "邀請旅伴",
  "Join this trip": "加入這趟旅程",
  "Keep current order": "保留目前順序",
  "Leave a note for this Trip…": "替這趟旅程留言…",
  "Let NekoTrip calculate the route": "讓 NekoTrip 計算路線",
  "List order": "排序方式",
  "Live": "即時",
  "Live route": "即時計算路線",
  "Loading members…": "載入成員中…",
  "Loading messages…": "載入留言中…",
  "Manage": "管理",
  "Manual amounts": "手動金額",
  "Manual split": "手動分攤",
  "Members": "成員",
  "Members, sharing, profile and Trip settings live here. Collaborators can plan together in realtime.": "成員、分享、個人資料與旅程設定都在這裡；旅伴可以即時一起規劃。",
  "Message Board": "留言板",
  "Mood": "心情",
  "Move earlier": "往前移",
  "Move later": "往後移",
  "My Wishlist": "我的願望清單",
  "My Wishlist ratings are copied as Trip snapshots. Shared Wishlist ratings stay linked and can be edited from either page.": "「我的願望清單」景點評分會於新增至旅程時自動匯入；「共享願望清單」景點評分則會與旅程頁面顯示的評分保持連結，並可在任一頁面編輯。",
  "NekoTrip invitation": "NekoTrip 邀請",
  "NekoTrip quick tour": "NekoTrip 快速導覽",
  "New folder name": "新資料夾名稱",
  "New trip name": "新旅程名稱",
  "Next →": "下一步 →",
  "Nickname is visible to collaborators. Emoji are welcome.": "暱稱會顯示給協作者，也可以使用 Emoji。",
  "Nickname saved.": "暱稱已儲存。",
  "Nickname · email · role": "暱稱 · 電子郵件 · 角色",
  "No consensus rating": "尚無共識評分",
  "No consensus score": "尚無共識分數",
  "No editor ratings yet.": "目前還沒有協作者評分。",
  "No end date": "尚未設定結束日期",
  "No expense": "無費用",
  "No expenses recorded yet.": "目前還沒有費用紀錄。",
  "No mapped address": "沒有地圖地址",
  "No mapped address yet": "尚無地圖地址",
  "No members found.": "找不到成員。",
  "No messages yet.": "目前還沒有留言。",
  "No password to remember. We send a one-time verification code to your email.": "不用記密碼，我們會寄送一次性驗證碼到你的電子郵件。",
  "No places in this view yet.": "此檢視目前沒有景點。",
  "No places in this view.": "此檢視沒有景點。",
  "No ratings": "尚無評分",
  "No score": "無分數",
  "No shares": "尚未分攤",
  "No start date": "尚未設定開始日期",
  "No trips yet. Create the first one.": "目前還沒有旅程，建立第一趟吧。",
  "No votes yet": "尚無投票",
  "Not rated": "尚未評分",
  "Not ready to build the itinerary yet? Save interesting places first and move them into a Trip later.": "還沒準備排行程？先收藏想去的地方，之後再加入旅程。",
  "Note": "備註",
  "Notes / Why saved": "備註 / 收藏原因",
  "Nothing saved in this view yet.": "此檢視目前沒有收藏。",
  "Only explicitly listed users can access this Shared Wishlist. Other site testers and Trip members are not added automatically.": "只有明確列出的使用者能存取此共享願望清單；其他網站測試者與旅程成員不會自動加入。",
  "Onsen": "溫泉",
  "Open a trip or manage its name and date range directly here.": "從這裡開啟旅程，或直接管理名稱與日期。",
  "Open emoji picker": "開啟 Emoji 選擇器",
  "Open setup checklist": "開啟設定清單",
  "Optimizing…": "最佳化中…",
  "Or start with Wishlist": "也可以先從願望清單開始",
  "Order": "順序",
  "Organize each day": "安排每一天",
  "Other members will see the new name. The trip URL stays unchanged.": "其他成員會看到新名稱，但旅程網址不會改變。",
  "Other members will see the new name. The trip slug and URL stay unchanged.": "其他成員會看到新名稱，但旅程代稱與網址不會改變。",
  "Paid": "已付清",
  "Paid?": "已付清？",
  "Permanent action": "永久操作",
  "Person": "成員",
  "Place": "景點",
  "Place search": "景點搜尋",
  "Places": "景點",
  "Plan": "規劃",
  "Plan together when you want": "隨時一起規劃",
  "Planned departure": "預計出發",
  "Post": "送出",
  "Posting…": "送出中…",
  "Preview only — nothing changes until you accept it.": "僅供預覽，在你採用前不會變更任何內容。",
  "Private to your account.": "僅你的帳號可見。",
  "Profile": "個人資料",
  "Refresh": "重新整理",
  "Refreshing…": "重新整理中…",
  "Remaining": "尚欠",
  "Remove": "移除",
  "Remove from selection": "從選取中移除",
  "Remove the expense record for this stop?": "要移除此停靠點的費用紀錄嗎？",
  "Removing…": "移除中…",
  "Rename this trip?": "要重新命名這趟旅程嗎？",
  "Renaming does not change the trip URL or existing invite links.": "重新命名不會改變旅程網址或既有邀請連結。",
  "Renaming keeps the existing trip URL and invitations.": "重新命名不會改變既有旅程網址與邀請。",
  "Renaming…": "重新命名中…",
  "Replay tutorial": "重新播放教學",
  "Restaurant": "餐廳",
  "Review rename": "確認新名稱",
  "Route error": "路線錯誤",
  "Route follows the current stop order.": "路線依目前停靠順序計算。",
  "Route mode": "路線模式",
  "Routing time": "路線時間基準",
  "Save": "儲存",
  "Save dates": "儲存日期",
  "Save day route": "儲存當日路線",
  "Save expense": "儲存費用",
  "Save nickname": "儲存暱稱",
  "Save note": "儲存備註",
  "Save places you are interested in": "收藏你感興趣的景點",
  "Saving…": "儲存中…",
  "Score": "分數",
  "Search Google": "搜尋 Google",
  "Search Google Places, choose a folder, category and rating, then save it to your Wishlist.": "搜尋 Google Places，選擇資料夾、分類與評分後存進願望清單。",
  "Search Google Places; every change is persisted and synced.": "搜尋 Google Places；每次變更都會儲存並同步。",
  "Search for a place, assign a day and category, then add it to this Trip.": "搜尋景點、指定日期與分類，再加入這趟旅程。",
  "Search once, decide which Trip later.": "先收藏，之後再決定要放進哪趟旅程。",
  "Searching…": "搜尋中…",
  "Select a day": "選擇一天",
  "Select mapped": "選取有地圖位置的項目",
  "Select places": "選擇景點",
  "Select several saved places, add them to an existing Trip, or create a new Trip from the selection.": "選取多個收藏景點，加入既有旅程，或直接建立新旅程。",
  "Select visible": "選取可見項目",
  "Selected place": "已選景點",
  "Selected wish": "已選收藏",
  "Sending…": "寄送中…",
  "Settled": "已結清",
  "Share trip": "分享旅程",
  "Shared Wishlist name": "共享願望清單名稱",
  "Shared Wishlist rating ranking": "共享願望清單評分排名",
  "Shared itinerary, Google Places, live map markers, and realtime collaboration.": "共享行程、Google Places、即時地圖標記與多人協作。",
  "Shopping": "購物",
  "Should pay": "應付",
  "Sightseeing": "觀光",
  "Sign in": "登入",
  "Sign out": "登出",
  "Signed in as": "目前登入",
  "Skip tutorial": "略過教學",
  "Snapshot from My Wishlist": "來自「我的願望清單」的快照",
  "Split": "分攤方式",
  "Spread": "分歧",
  "Standard": "標準",
  "Stars": "星級",
  "Start": "開始",
  "Start / lodging": "起點 / 住宿",
  "Start date": "開始日期",
  "Station": "車站",
  "Stay & transport": "住宿與交通",
  "Stay (min)": "停留（分鐘）",
  "Stops": "停靠點",
  "Suggest best order": "建議最佳順序",
  "Suggested route": "建議路線",
  "Switch between your private Wishlist and Shared Wishlists. Shared collections support collaborators and group ratings.": "可在私人願望清單與共享願望清單之間切換；共享清單支援多人協作與共同評分。",
  "The creator becomes owner automatically. Four starter days are created for you.": "建立者會自動成為擁有者，並自動建立初始行程天數。",
  "The itinerary day count will be adjusted automatically. If the Trip becomes shorter, places assigned to removed days will be moved to Unplanned.": "行程天數會自動調整。若旅程縮短，被移除日期中的景點會移至「未安排」。",
  "The map follows the selected folder scope. Use Select mapped to grab every mapped place in the current view.": "地圖會依目前選取的資料夾範圍顯示；使用「選取有地圖位置的項目」可一次選取目前檢視中的所有地圖景點。",
  "The selected wishes stay in your Wishlist and are also copied into the new Trip as Unplanned places.": "已選收藏會保留在願望清單中，並同時複製到新旅程的「未安排」景點。",
  "This cannot be undone. Everyone with access will lose this trip and its itinerary.": "此操作無法復原，所有可存取此旅程的人都會失去旅程與行程內容。",
  "This cannot be undone. Type the exact trip name to confirm.": "此操作無法復原。請輸入完整旅程名稱以確認。",
  "Tickets, hotel deposit, dinner…": "門票、飯店訂金、晚餐…",
  "Top level": "最上層",
  "Total cost": "總金額",
  "Track each stop, split evenly or manually, and record how much each person has already paid.": "記錄每個停靠點的花費，可平均或手動分攤，並追蹤每個人已支付的金額。",
  "Traffic": "路況",
  "Transit": "大眾運輸",
  "Transit uses Google’s current/default departure-time context until NekoTrip stores a departure time for the day.": "在 NekoTrip 尚未儲存當日出發時間前，大眾運輸會使用 Google 目前／預設的出發時間。",
  "Travel emoji picker": "旅遊 Emoji 選擇器",
  "Travel time": "移動時間",
  "Trip Expenses": "旅費",
  "Trip Map": "旅程地圖",
  "Trip dates": "旅程日期",
  "Trip dates updated. Day dates were realigned to the departure date.": "旅程日期已更新，各天日期已依出發日期重新對齊。",
  "Trip day": "旅程日期",
  "Trip departure date": "旅程出發日期",
  "Trip discussion for collaborators.": "旅程協作者的討論區。",
  "Trip end date": "旅程結束日期",
  "Trip name": "旅程名稱",
  "Trip settings": "旅程設定",
  "Trip slug:": "旅程代稱：",
  "Trip-only rating": "僅旅程內評分",
  "Trips": "旅程",
  "Trips you can access": "你可以存取的旅程",
  "Trips, planned together.": "一起規劃旅程。",
  "Turn ideas into an itinerary": "把想法變成行程",
  "Type": "類型",
  "Unfiled": "未分類",
  "Unique nickname": "唯一暱稱",
  "Unmapped": "無地圖位置",
  "Unpaid": "未付",
  "Unplanned": "未安排",
  "Unselect visible": "取消選取可見項目",
  "Update dates": "更新日期",
  "Updated": "已更新",
  "Use a different email": "使用其他電子郵件",
  "Use first itinerary stop": "使用行程第一站",
  "Use last itinerary stop": "使用行程最後一站",
  "Use live traffic": "使用即時路況",
  "Verification code": "驗證碼",
  "Verification code sent. Check your email and enter the code below.": "驗證碼已寄出，請查看電子郵件並輸入下方驗證碼。",
  "Verifying…": "驗證中…",
  "Viewer access: browse only.": "檢視者權限：僅可瀏覽。",
  "Viewer access: read only.": "檢視者權限：唯讀。",
  "Votes": "票數",
  "Waiting": "等待中",
  "Walking": "步行",
  "Wish List": "願望清單",
  "Wishlist": "願望清單",
  "Wishlist Map": "願望清單地圖",
  "Wishlist place search": "願望清單景點搜尋",
  "Wishlist selection": "願望清單選取",
  "Your Stars": "你的星級",
  "Your profile": "你的個人資料",
  "Your rating": "你的評分",
  "Your trips": "你的旅程",
  "editor": "編輯者",
  "owner": "擁有者",
  "total trip cost": "旅程總費用",
  "viewer": "檢視者",
  "“All” view does not draw a multi-day route.": "「全部」檢視不會繪製跨多日路線。",
  "Score = 70% average + 20% voter coverage + 10% agreement. Higher is the stronger group choice.": "分數 = 70% 平均評分 + 20% 投票覆蓋率 + 10% 意見一致度。分數越高，代表越適合作為團體共同選擇。",
  "Drive": "開車",
  "Walk": "步行",
  "🚗 Drive": "🚗 開車",
  "🚆 Transit": "🚆 大眾運輸",
  "🚶 Walk": "🚶 步行",
};

function roleZh(role: string) {
  return zhTW[role] ?? role;
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'zh-TW' ? 'zh-TW' : 'en';
}

export function translateText(locale: Locale, input: string): string {
  if (locale !== 'zh-TW') return input;

  const exact = zhTW[input];
  if (exact) return exact;

  let match: RegExpMatchArray | null;

  match = input.match(/^(\d+) members?$/);
  if (match) return `${match[1]} 位成員`;

  match = input.match(/^(\d+) selected$/);
  if (match) return `已選 ${match[1]} 個`;

  match = input.match(/^(\d+) places?$/);
  if (match) return `${match[1]} 個景點`;

  match = input.match(/^(\d+) mapped \/ (\d+) visible$/);
  if (match) return `地圖位置 ${match[1]} / 可見 ${match[2]}`;

  match = input.match(/^Manage (.+)$/);
  if (match) return `管理 ${match[1]}`;

  match = input.match(/^Delete (.+)\?$/);
  if (match) return `刪除 ${match[1]}？`;

  match = input.match(/^Your role: (owner|editor|viewer)$/);
  if (match) return `你的角色：${roleZh(match[1])}`;

  match = input.match(/^(.+) · shared · (owner|editor|viewer)$/);
  if (match) return `${match[1]} · 共享 · ${roleZh(match[2])}`;

  match = input.match(/^(.+) · private$/);
  if (match) return `${match[1]} · 私人`;

  match = input.match(/^(.+) route plan$/);
  if (match) return `${match[1]} 路線規劃`;

  match = input.match(/^Linked to (.+)$/);
  if (match) return `連結至 ${match[1]}`;


  match = input.match(/^Avg ([0-9.]+) \/ 5$/);
  if (match) return `平均 ${match[1]} / 5`;

  match = input.match(/^·?\s*(\d+)\/(\d+) voted$/);
  if (match) return `· ${match[1]}/${match[2]} 已投票`;

  match = input.match(/^·?\s*spread ([0-9.]+)$/);
  if (match) return `· 分歧 ${match[1]}`;

  match = input.match(/^Avg\s+([0-9.]+)\s*\/\s*5\s*·\s*(\d+)\/(\d+)\s+voted(?:\s*·\s*spread\s+([0-9.]+))?$/);
  if (match) return `平均 ${match[1]} / 5 · ${match[2]}/${match[3]} 已投票${match[4] ? ` · 分歧 ${match[4]}` : ''}`;

  match = input.match(/^Consensus ([0-9.]+) · (\d+)\/(\d+) voted(?: · spread ([0-9.]+))?$/);
  if (match) return `共識 ${match[1]} · ${match[2]}/${match[3]} 已投票${match[4] ? ` · 分歧 ${match[4]}` : ''}`;

  match = input.match(/^(\d+)\/(\d+) paid$/);
  if (match) return `${match[1]}/${match[2]} 已付清`;

  match = input.match(/^(.+) total trip cost$/);
  if (match) return `${match[1]} 旅程總費用`;

  match = input.match(/^Shared in (.+)\.$/);
  if (match) return `共享於 ${match[1]}。`;

  match = input.match(/^Shared with (.+)\.$/);
  if (match) return `共享於 ${match[1]}。`;

  match = input.match(/^Create a Trip from (\d+) selected places?$/);
  if (match) return `從 ${match[1]} 個已選景點建立旅程`;

  match = input.match(/^Select map view \((\d+)\)$/);
  if (match) return `選取地圖檢視（${match[1]}）`;

  return input;
}

export function tr(locale: Locale, input: string): string {
  return translateText(locale, input);
}
