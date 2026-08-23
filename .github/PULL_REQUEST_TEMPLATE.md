# Pull Request – IDOSI

## Mục tiêu
Mô tả ngắn gọn vấn đề hoặc chức năng được xử lý trong PR này.

## Phạm vi thay đổi
- [ ] UI / components
- [ ] State
- [ ] Domain / business logic
- [ ] API / services
- [ ] Backend / Worker
- [ ] Database / migration
- [ ] Test
- [ ] CI / tooling
- [ ] Documentation

## Impact Map
Ghi rõ luồng bị ảnh hưởng:

`Yêu cầu → dữ liệu → domain → API → state → UI → database → test`

Các module liên quan hoặc có nguy cơ regression:
- 

## Business rules
Liệt kê các quy tắc nghiệp vụ đã thêm hoặc thay đổi. Nếu không có, ghi `Không thay đổi business rule`.

## Phân quyền & store isolation
- Vai trò được phép thao tác:
- Vai trò chỉ được xem:
- Đã kiểm tra authorization ở backend: [ ]
- Đã kiểm tra dữ liệu chỉ nằm trong đúng store scope: [ ]

## Database / migration
- Có thay đổi schema không? Có / Không
- Nếu có, migration:
- Có tương thích dữ liệu cũ không? Có / Không / Không áp dụng

## Kiểm thử
Kết quả bắt buộc trước khi merge:

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run sites:verify`

Test nghiệp vụ mới hoặc đã cập nhật:
- 

## Kiểm tra thủ công
- [ ] Desktop
- [ ] Mobile / responsive nếu có UI
- [ ] Loading state
- [ ] Empty state
- [ ] Error state
- [ ] Permission denied / unauthorized nếu liên quan

## Dữ liệu nhạy cảm
- [ ] Không commit password, token, secret hoặc dữ liệu production nhạy cảm
- [ ] Không dùng `localStorage` làm nguồn dữ liệu production mới
- [ ] Không hard-code dữ liệu cửa hàng, nhân viên, quyền hoặc số tiền nếu hệ thống đã có nguồn dữ liệu

## Rủi ro / lưu ý
Nêu rõ rủi ro còn lại hoặc bước cần kiểm tra sau deploy.

## Definition of Done
- [ ] Chỉ thay đổi đúng phạm vi yêu cầu
- [ ] Không tạo logic nghiệp vụ trùng lặp
- [ ] Không phá chức năng hiện có
- [ ] Test cần thiết đã được bổ sung/cập nhật
- [ ] Verify IDOSI PASS
- [ ] Diff đã được review trước khi merge
