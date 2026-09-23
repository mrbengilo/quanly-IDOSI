# API số liệu cửa hàng dành cho website kho IDOSI

API này chỉ trả dữ liệu tổng hợp doanh thu, số đơn và số lượng mặt hàng. API
không trả đơn hàng thô, tên nhân viên, khách hàng hoặc số điện thoại.

## Endpoint

```text
GET https://idosi.io.vn/api/integrations/warehouse/v1/order-statistics
```

Đường dẫn cũ `/api/integrations/warehouse/order-statistics` vẫn được hỗ trợ với cùng kết quả.

Header xác thực (chọn một):

```http
Authorization: Bearer <WAREHOUSE_API_KEY>
```

```http
X-IDOSI-Warehouse-Key: <WAREHOUSE_API_KEY>
```

Nên gọi endpoint từ backend của website kho để khóa không xuất hiện trong mã
JavaScript tải về trình duyệt.

## Bộ lọc

| Tham số | Bắt buộc | Ý nghĩa |
|---|---:|---|
| `storeId` | Có | Mã cửa hàng vật lý đang hoạt động |
| `period` | Có | Tháng dạng `YYYY-MM` |
| `date` | Không | Ngày dạng `YYYY-MM-DD`, phải thuộc `period` |
| `shiftId` | Không | Mã ca trong tháng/ngày đã chọn |
| `paymentMethod` | Không | `cash`, `transfer`, `Tiền mặt` hoặc `Chuyển khoản` |

Các tham số khác, tham số lặp hoặc ngày không thuộc tháng đều bị từ chối. API
không cho lọc theo nhân viên hay tìm kiếm nội dung đơn hàng.

Ví dụ:

```bash
export IDOSI_WAREHOUSE_API_KEY='<khóa-được-cấp>'
curl --fail --silent --show-error \
  -H "Authorization: Bearer $IDOSI_WAREHOUSE_API_KEY" \
  'https://idosi.io.vn/api/integrations/warehouse/order-statistics?storeId=S01&period=2026-09&date=2026-09-12'
unset IDOSI_WAREHOUSE_API_KEY
```

## Response thành công

```json
{
  "ok": true,
  "apiVersion": 1,
  "storeId": "S01",
  "currency": "VND",
  "timezone": "Asia/Ho_Chi_Minh",
  "revenueBasis": "ACTIVE_ORDER_AMOUNT",
  "generatedAt": "2026-09-14T02:00:00.000Z",
  "store": { "id": "S01", "name": "Cửa hàng Quận 1" },
  "filters": {
    "period": "2026-09",
    "date": "2026-09-12",
    "shiftId": null,
    "paymentMethod": null
  },
  "totals": {
    "orders": 9,
    "cash": 800000,
    "transfer": 1200000,
    "revenue": 2000000,
    "cashOrders": 4,
    "transferOrders": 5,
    "revenueByType": { "NORMAL": 1500000, "SALE_KG": 200000, "SALE_PIECE": 300000 },
    "unclassifiedRevenue": 0,
    "unclassifiedOrders": 0,
    "weight": {
      "schemaVersion": 1,
      "unit": "KG",
      "tableVersion": "IDOSI-2026-09-21-v4",
      "actualKg": 10,
      "estimatedKg": 5,
      "knownKg": 15,
      "totalKg": 15,
      "isComplete": true,
      "missingFactorLines": 0,
      "invalidLines": 0,
      "unclassifiedOrders": 0,
      "byRevenueType": {
        "NORMAL": { "actualKg": 0, "estimatedKg": 4, "knownKg": 4, "totalKg": 4, "isComplete": true, "missingFactorLines": 0, "invalidLines": 0, "unclassifiedOrders": 0 },
        "SALE_KG": { "actualKg": 10, "estimatedKg": 0, "knownKg": 10, "totalKg": 10, "isComplete": true, "missingFactorLines": 0, "invalidLines": 0, "unclassifiedOrders": 0 },
        "SALE_PIECE": { "actualKg": 0, "estimatedKg": 1, "knownKg": 1, "totalKg": 1, "isComplete": true, "missingFactorLines": 0, "invalidLines": 0, "unclassifiedOrders": 0 }
      }
    }
  },
  "products": {
    "totalQuantity": 15,
    "salePieceQuantity": 3,
    "totalWeightKg": 10,
    "productTypes": 3,
    "ordersWithItems": 9,
    "unclassifiedOrders": 0,
    "weight": "<cùng cấu trúc totals.weight>",
    "weightByProduct": ["<xem cấu trúc mô tả bên dưới>"],
    "items": [
      {
        "productId": "PRODUCT-MEN",
        "productCode": "DO-NAM",
        "productName": "Quần áo nam",
        "quantity": 7,
        "unit": "PIECE",
        "revenueType": "NORMAL",
        "classification": "NORMAL",
        "orders": 4,
        "weight": "<cùng cấu trúc totals.weight>"
      }
    ]
  },
  "groups": {
    "shift": [],
    "day": [],
    "month": []
  },
  "serverTime": "2026-09-12T00:00:00.000Z",
  "requestId": "..."
}
```

Các giá trị chuỗi trong dấu `<...>` ở ví dụ là chỗ rút gọn để dễ đọc, không
phải dữ liệu API. Response thực tế trả object khối lượng đầy đủ cho mỗi dòng.

`groups.shift`, `groups.day` và `groups.month` dùng cùng cấu trúc tổng tiền/số đơn trong
`totals`; nhóm ca còn có `shiftId`, `shiftName`, `shiftStart`, `shiftEnd` nếu đơn
hàng đã lưu snapshot ca.

## Đối soát sale theo từng cửa hàng

Mỗi request chỉ chứa **một** `storeId`. `storeId` ở response và `store.id` phải
trùng mã cửa hàng đã yêu cầu; consumer từ chối response sai cửa hàng và lưu
snapshot theo cửa hàng cùng phạm vi `period`/`date`/`shiftId`/`paymentMethod`.
Không cộng snapshot của các lần gọi lặp lại. Bộ lọc cửa hàng được áp dụng trước
khi tính mọi tổng và mọi nhóm; khóa tích hợp có thể bị giới hạn thêm bằng
`WAREHOUSE_API_STORE_IDS`.

| Chỉ số cho một cửa hàng/phạm vi | Trường nguồn | Đơn vị/ý nghĩa |
|---|---|---|
| Doanh thu sale theo cái | `totals.revenueByType.SALE_PIECE` | đồng VND nguyên |
| Số lượng sale theo cái | `products.salePieceQuantity` | số cái nguyên, không gồm bán thường |
| Khối lượng sale theo cái | `totals.weight.byRevenueType.SALE_PIECE.estimatedKg` | kg **quy đổi ước tính** từ hệ số mặt hàng; chỉ coi là đủ khi `isComplete=true` |
| Doanh thu sale theo ký | `totals.revenueByType.SALE_KG` | đồng VND nguyên |
| Khối lượng sale theo ký | `totals.weight.byRevenueType.SALE_KG.actualKg` | kg thực bán, không quy đổi lần nữa |

`products.items[]` có `revenueType`, `classification`, `unit`, `quantity` và
`weight` để đối chiếu số cái/kg theo **từng mặt hàng**; ưu tiên
`canonicalProductId` khi gộp mặt hàng đã đổi tên hoặc mã. `products.totalQuantity`
là NORMAL + SALE_PIECE, còn `products.totalWeightKg` chỉ là SALE_KG. Không cộng
kg vào cái. Kg trong `weight` được cộng bằng phân số rồi làm tròn tối đa 6 chữ số
thập phân; giao diện có thể hiển thị 3 chữ số, nhưng không cộng các số đã làm
tròn của từng dòng để đối soát tổng. Nếu `isComplete=false`, `totalKg=null`:
hiển thị phần `knownKg` với cảnh báo thiếu dữ liệu, không hiện 0 giả.
`products.weight` dùng cùng cấu trúc với `totals.weight`;
`products.weightByProduct[]` gộp từng mã mặt hàng qua ba loại bán và chứa
`totalQuantity`, `orders`, `weight`. Mỗi dòng `products.items[].weight` cũng
dùng cấu trúc khối lượng đó. `groups.shift/day/month[].weight` thuộc đúng nhóm
ca/ngày/tháng tương ứng.

`totals.unclassifiedOrders` đếm đơn không có dòng hàng hoặc có ít nhất một dòng
thiếu `revenueType`; khác `products.unclassifiedOrders`, vốn chỉ đếm đơn không
có dòng hàng. `totals.unclassifiedRevenue` là **toàn bộ phần NORMAL còn lại của
những đơn đó**. Nếu một đơn trộn dòng NORMAL có dấu và thiếu dấu, hệ thống không
phân bổ phần tiền còn lại cho từng dòng vì không có giá dòng NORMAL; toàn bộ
phần đó nằm ở Chưa phân loại. `products.items[].classification` là
`UNCLASSIFIED` cho dòng thiếu dấu, còn lại bằng `revenueType`. Từ phiên bản này,
dòng Bán thường mới lưu `revenueType: NORMAL` rõ ràng; không tự backfill đơn cũ.

Giữ `totals.revenueByType.NORMAL` dạng cũ để client v1 không đổi số. Khi hiển
thị riêng, **Bán thường đã phân loại** = `revenueByType.NORMAL -
unclassifiedRevenue`. Phải đối chiếu cả hai bất biến:

```text
revenueByType.NORMAL + SALE_KG + SALE_PIECE = totals.revenue
(revenueByType.NORMAL - unclassifiedRevenue) + SALE_KG + SALE_PIECE + unclassifiedRevenue = totals.revenue
```

Lệch số là lỗi/cảnh báo để đối soát, không tự sửa doanh thu. Tiền phải là số
nguyên an toàn; snapshot thiếu trường phân loại mới phải báo **cần đồng bộ lại**.

## CORS và cấu hình production

```dotenv
WAREHOUSE_API_KEY=<chuỗi-ngẫu-nhiên-tối-thiểu-32-ký-tự>
WAREHOUSE_API_ALLOWED_ORIGINS=https://kho.example.vn
# Tùy chọn: để trống giữ phạm vi mọi cửa hàng vật lý; giới hạn bằng danh sách mã.
WAREHOUSE_API_STORE_IDS=S01,S02
```

- Request server-to-server không gửi `Origin` vẫn hoạt động khi khóa hợp lệ.
- Request từ trình duyệt chỉ được phép từ origin HTTPS có trong allowlist.
- Không hỗ trợ wildcard `*` vì response có dữ liệu doanh thu.
- Endpoint không cache response và không dùng cookie đăng nhập IDOSI.

## Mã lỗi chính

| HTTP | Mã | Ý nghĩa |
|---:|---|---|
| 400 | `WAREHOUSE_FILTER_INVALID` | Bộ lọc sai, lặp hoặc không được hỗ trợ |
| 401 | `WAREHOUSE_API_UNAUTHORIZED` | Thiếu/sai khóa |
| 403 | `WAREHOUSE_STORE_FORBIDDEN` | Cửa hàng ngoài phạm vi khóa tích hợp |
| 403 | `WAREHOUSE_ORIGIN_FORBIDDEN` | Origin trình duyệt không nằm trong allowlist |
| 400 | `STORE_INVALID` | Thiếu mã cửa hàng vật lý hoặc không tìm thấy cửa hàng |
| 409 | `STORE_INACTIVE` | Cửa hàng đã ngừng hoạt động |
| 503 | `WAREHOUSE_API_NOT_CONFIGURED` | VPS chưa có khóa hợp lệ |

Luân chuyển khóa bằng cách đổi `WAREHOUSE_API_KEY` ở cả VPS IDOSI và backend
website kho, sau đó restart app qua quy trình triển khai/restart được kiểm soát.


## Ba loại doanh thu và quy tắc đối soát

- `NORMAL`: tiền bán thường theo cách nhập hiện tại.
- `SALE_KG`: tiền hàng sale theo kg, tối đa 3 số lẻ khối lượng.
- `SALE_PIECE`: tiền hàng sale theo cái, số lượng nguyên.

`totals.revenue = NORMAL + SALE_KG + SALE_PIECE`. Hai loại sale thuộc một nhóm;
không cộng lại tổng sale vào tổng doanh thu lần thứ hai. Một đơn kết hợp chỉ tăng
`totals.orders` một lần. Tiền mặt/chuyển khoản là chiều thanh toán độc lập.

Đơn giá sale và thành tiền theo đồng nguyên. Thành tiền từng dòng được tính bằng
số nguyên (kg đổi sang gram), làm tròn nửa lên một lần ở dòng. Tổng báo cáo cộng
các dòng/đơn đã ghi nhận, không tính từ trang danh sách đang phân trang.

`products.totalQuantity` chỉ đếm **cái**; `products.totalWeightKg` chỉ đếm **kg**.
Một mặt hàng có thể có bốn dòng tổng hợp sản phẩm theo `productId + classification`
(ba loại đã phân loại và `UNCLASSIFIED`).
Không cộng kg vào cái, không tự quy đổi kg từ số cái hoặc phân bổ tiền bán thường
cho từng mặt hàng khi hệ thống chỉ có tổng tiền thường.

Doanh thu giữ đúng chính sách đang có của IDOSI: tính đơn hợp lệ chưa xóa mềm,
không tính bản ghi chuyển tiếp `legacy-opening-balance`. Bản cập nhật này không
thêm một hệ thống hoàn tiền/chiết khấu khác và không đổi công thức thưởng. Ngày
báo cáo theo logic ngày kinh doanh hiện có (timestamp Việt Nam); ca giữ snapshot
của đơn. Không thay đổi ngầm quy tắc kỳ lương hoặc ca qua đêm.

Đơn lịch sử thiếu dấu phân loại vẫn nằm trong `revenueByType.NORMAL` để tương
thích v1, đồng thời phần tiền đó được báo riêng qua `unclassifiedRevenue` như
quy tắc ở trên. Không suy đoán sale từ giá, tên hàng hoặc ghi chú. Admin cần
đối soát và sửa có lý do trước khi chuyển đơn lịch sử sang loại đã xác nhận.

## Đồng bộ từ website kho

Gọi theo từng `storeId` và `period`; thêm `date`/`shiftId` khi cần. Response là
**ảnh chụp tổng hợp tại thời điểm gọi**, không phải phần doanh thu mới phát sinh.
Kho phải **ghi đè/upsert** bản tổng hợp cùng khóa phạm vi, tuyệt đối không cộng
response của lần gọi lại vào lần trước. Chỉ dùng response HTTP 200, `ok=true` có
đủ ba khóa doanh thu và kiểm tra đẳng thức tổng; lỗi mạng/xác thực không phải 0đ.
Giữ số lần thành công gần nhất và thông báo dữ liệu cũ nếu đồng bộ lỗi.

Cấu hình khóa và danh sách cửa hàng trên VPS qua biến môi trường (Compose nạp
`.env`); Worker dùng biến/secret tương ứng. Không đưa khóa vào UI, repo, log hoặc
localStorage. Endpoint chỉ đọc số liệu; không cần cấp quyền admin cho web kho.

Thông số mới tương thích bổ sung trong v1; consumer phải chấp nhận trường mới.
Đây là API thống kê, **không phải** API nhật ký từng giao dịch để xuất tồn.
Không dùng polling tổng doanh thu làm sự kiện trừ kho từng đơn.
