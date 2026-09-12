# API số liệu cửa hàng dành cho website kho IDOSI

API này chỉ trả dữ liệu tổng hợp doanh thu, số đơn và số lượng mặt hàng. API
không trả đơn hàng thô, tên nhân viên, khách hàng hoặc số điện thoại.

## Endpoint

```text
GET https://idosi.io.vn/api/integrations/warehouse/order-statistics
```

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
    "transferOrders": 5
  },
  "products": {
    "totalQuantity": 15,
    "productTypes": 3,
    "ordersWithItems": 9,
    "unclassifiedOrders": 0,
    "items": [
      {
        "productId": "PRODUCT-MEN",
        "productCode": "DO-NAM",
        "productName": "Đồ nam",
        "quantity": 7,
        "orders": 4
      }
    ]
  },
  "groups": {
    "shift": [],
    "day": []
  },
  "serverTime": "2026-09-12T00:00:00.000Z",
  "requestId": "..."
}
```

`groups.shift` và `groups.day` dùng cùng cấu trúc tổng tiền/số đơn trong
`totals`; nhóm ca còn có `shiftId`, `shiftName`, `shiftStart`, `shiftEnd` nếu đơn
hàng đã lưu snapshot ca.

## CORS và cấu hình production

```dotenv
WAREHOUSE_API_KEY=<chuỗi-ngẫu-nhiên-tối-thiểu-32-ký-tự>
WAREHOUSE_API_ALLOWED_ORIGINS=https://kho.example.vn
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
| 403 | `WAREHOUSE_ORIGIN_FORBIDDEN` | Origin trình duyệt không nằm trong allowlist |
| 400 | `STORE_INVALID` | Thiếu mã cửa hàng vật lý hoặc không tìm thấy cửa hàng |
| 409 | `STORE_INACTIVE` | Cửa hàng đã ngừng hoạt động |
| 503 | `WAREHOUSE_API_NOT_CONFIGURED` | VPS chưa có khóa hợp lệ |

Luân chuyển khóa bằng cách đổi `WAREHOUSE_API_KEY` ở cả VPS IDOSI và backend
website kho, sau đó restart app qua quy trình triển khai/restart được kiểm soát.
