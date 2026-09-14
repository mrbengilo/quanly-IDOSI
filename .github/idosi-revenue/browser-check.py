from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import os, json, re, datetime, traceback
out=Path(os.environ.get('RUNNER_TEMP','/tmp'))/'revenue-evidence'
out.mkdir(parents=True,exist_ok=True)
root='http://127.0.0.1:4040'
report=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=None
 try:
  def login(user):
   context=browser.new_context(viewport={'width':1440,'height':1080})
   view=context.new_page()
   view.goto(root+'/#/login',wait_until='networkidle')
   view.get_by_label('Tên đăng nhập').fill(user)
   view.get_by_label('Mật khẩu',exact=True).fill('Synthetic-password-2026')
   view.get_by_role('button',name='Đăng nhập',exact=True).click()
   view.wait_for_url(re.compile(r'.*#/(employee|store)/.*'),timeout=30000)
   return view
  page=login('test.employee')
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(root+'/#/employee/orders',wait_until='networkidle')
  expect(page.get_by_role('button',name='TẠO ĐƠN HÀNG',exact=True)).to_be_enabled()
  assert 'Không được hiển thị cho E1' not in page.locator('body').inner_text()
  page.get_by_role('button',name='TẠO ĐƠN HÀNG',exact=True).click()
  dialog=page.get_by_role('dialog')
  dialog.get_by_label(re.compile('Tên khách hàng')).fill('Khách thử nghiệm ba loại')
  dialog.get_by_label(re.compile('Giới tính')).select_option(index=1)
  dialog.get_by_role('combobox',name='Nghề nghiệp',exact=True).click()
  page.get_by_role('option').first.click()
  dialog.get_by_label(re.compile('Biết qua kênh nào')).select_option(index=1)
  dialog.get_by_label(re.compile('Hình thức thanh toán')).select_option(label='Tiền mặt')
  dialog.get_by_role('checkbox',name=re.compile('Đồ nam')).check()
  dialog.get_by_label('Số lượng Đồ nam',exact=True).fill('2')
  dialog.get_by_placeholder('Nhập số tiền',exact=True).fill('100000')
  dialog.get_by_role('tab',name=re.compile('Sale theo ký')).click()
  dialog.get_by_role('checkbox',name=re.compile('Đồ nam')).check()
  dialog.get_by_label('Khối lượng Đồ nam',exact=True).fill('2.5')
  dialog.get_by_label('Đơn giá Đồ nam',exact=True).fill('20000')
  page.screenshot(path=str(out/'create-order-sale-kg-desktop.png'),full_page=True)
  dialog.get_by_role('tab',name=re.compile('Sale theo cái')).click()
  dialog.get_by_role('checkbox',name=re.compile('Đồ nam')).check()
  dialog.get_by_label('Số lượng Đồ nam',exact=True).fill('3')
  dialog.get_by_label('Đơn giá Đồ nam',exact=True).fill('10000')
  preview=dialog.get_by_role('region',name='Tổng tiền đơn đang nhập')
  expect(preview).to_contain_text('180,000 đ')
  page.screenshot(path=str(out/'create-order-mixed-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path=str(out/'create-order-mixed-mobile.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile create page overflow'
  with page.expect_response(lambda response: '/api/command' in response.url and response.request.method=='POST') as saved:
   dialog.get_by_role('button',name='LƯU ĐƠN',exact=True).click()
  assert saved.value.ok, f'Create HTTP {saved.value.status}'
  expect(dialog).not_to_be_visible(timeout=30000)
  page.reload(wait_until='networkidle')
  summary=page.get_by_role('region',name='Doanh thu của tôi trong ca',exact=True)
  for value in ['100,000 đ','50,000 đ','30,000 đ','180,000 đ']: expect(summary).to_contain_text(value)
  assert 'Không được hiển thị cho E1' not in page.locator('body').inner_text()
  assert '700,000 đ' not in page.locator('body').inner_text()
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile employee page overflow'
  page.screenshot(path=str(out/'employee-revenue-mobile.png'),full_page=True)
  page.set_viewport_size({'width':1440,'height':1080})
  page.screenshot(path=str(out/'employee-revenue-desktop.png'),full_page=True)
  report.append('PASS: real UI -> create command -> SQLite -> reload; own revenue 100000/50000/30000/180000; no colleague data')
  page=login('test.store')
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(root+'/#/store/statistics',wait_until='networkidle')
  summary=page.locator('.store-statistics-page .order-revenue-summary')
  expect(summary).to_contain_text('880,000 đ')
  page.get_by_label('Xem thống kê theo',exact=True).select_option('month')
  expect(summary).to_contain_text('880,000 đ')
  page.screenshot(path=str(out/'store-revenue-month-desktop.png'),full_page=True)
  page.get_by_role('button',name='Xem ngày',exact=True).first.click()
  expect(page.get_by_label('Xem thống kê theo',exact=True)).to_have_value('day')
  expect(summary).to_contain_text('880,000 đ')
  page.screenshot(path=str(out/'store-revenue-day-desktop.png'),full_page=True)
  page.get_by_role('row').filter(has_text='Ca sáng').get_by_role('button',name='Xem ca',exact=True).click()
  expect(page.get_by_label('Xem thống kê theo',exact=True)).to_have_value('shift')
  expect(summary).to_contain_text('180,000 đ')
  page.get_by_role('button',name='Làm mới số liệu',exact=True).click()
  expect(summary).to_contain_text('180,000 đ')
  page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile statistics page overflow'
  page.screenshot(path=str(out/'store-revenue-shift-mobile.png'),full_page=True)
  now=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7)))
  response=page.request.get(root+'/api/integrations/warehouse/v1/order-statistics',params={'storeId':'S1','period':now.strftime('%Y-%m'),'date':now.strftime('%Y-%m-%d'),'shiftId':'AM'},headers={'X-IDOSI-Warehouse-Key':'synthetic-warehouse-browser-testing-key'})
  assert response.ok, response.status
  data=response.json()
  assert data['totals']['revenue']==180000, data
  assert data['totals']['revenueByType']=={'NORMAL':100000,'SALE_KG':50000,'SALE_PIECE':30000}, data
  assert 'customerName' not in json.dumps(data), 'Warehouse response exposed customer data'
  (out/'warehouse-response.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
  report.append('PASS: store month -> day -> shift buttons and refresh; warehouse API equals UI; mobile no horizontal overflow')
  page.set_viewport_size({'width':1440,'height':1080})
  page.goto(root+'/#/store/orders',wait_until='networkidle')
  expect(page.locator('.order-revenue-summary').first).to_contain_text('880,000 đ')
  page.screenshot(path=str(out/'store-orders-desktop.png'),full_page=True)
  assert not errors, errors
  report.append('PASS: store Orders revenue cards; no browser runtime exceptions')
 except Exception:
  if page:
   page.screenshot(path=str(out/'browser-failure.png'),full_page=True)
   (out/'browser-failure-text.txt').write_text(page.locator('body').inner_text())
  report.append(traceback.format_exc())
  raise
 finally:
  (out/'browser-results.txt').write_text('\n'.join(report))
  browser.close()
