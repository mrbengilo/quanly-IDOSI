import json, re, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path('/tmp/idosi-revenue-browser'); out=root/'evidence'; out.mkdir(exist_ok=True)
c=json.loads((root/'access.json').read_text()); errors=[]; checks=[]
def mark(name):
    checks.append(name); print('PASS:',name,flush=True)
def login(page, username, destination):
    page.goto(c['base']+'/#/login',wait_until='networkidle')
    page.get_by_label('Tên đăng nhập',exact=True).fill(username)
    page.get_by_label('Mật khẩu',exact=True).fill(c['password'])
    page.get_by_role('button',name='Đăng nhập',exact=True).click()
    page.wait_for_url('**/'+destination,timeout=30000)
def card(region, kind, amount):
    expect(region.get_by_test_id('revenue-'+kind)).to_contain_text(f'{amount:,} đ',timeout=30000)
def capture(page,name):
    page.screenshot(path=str(out/(name+'.png')),full_page=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1100},timezone_id='Asia/Ho_Chi_Minh')
    page=context.new_page(); page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        login(page,'employee.preview','employee/home')
        page.goto(c['base']+'/#/employee/orders',wait_until='networkidle')
        own=page.get_by_role('region',name='Doanh thu của tôi trong ca',exact=True)
        for kind,amount in [('NORMAL',100000),('SALE_KG',50000),('SALE_PIECE',30000),('TOTAL',180000)]: card(own,kind,amount)
        expect(page.locator('body')).not_to_contain_text('BOB-SECRET')
        expect(page.locator('body')).not_to_contain_text('FOREIGN-SECRET')
        expect(page.locator('body')).not_to_contain_text('Doanh thu toàn ca')
        capture(page,'employee-orders-desktop'); mark('Employee only sees personally-created shift orders and all four correct totals')
        page.set_viewport_size({'width':390,'height':844})
        capture(page,'employee-orders-mobile')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Employee page overflows mobile viewport'
        mark('Employee mobile page has no horizontal overflow')
        page.get_by_role('button',name='TẠO ĐƠN HÀNG',exact=True).click()
        dialog=page.get_by_role('dialog')
        dialog.get_by_label(re.compile('^Tên khách hàng')).fill('Khách kiểm thử sale ký')
        dialog.get_by_label(re.compile('^Giới tính')).select_option(index=1)
        dialog.get_by_role('combobox',name='Nghề nghiệp',exact=True).click()
        dialog.get_by_role('option').first.click()
        dialog.get_by_label(re.compile('^Biết qua kênh nào')).select_option(index=1)
        dialog.get_by_role('group',name='Chọn loại bán',exact=True).get_by_role('button',name=re.compile('Sale theo ký')).click()
        dialog.get_by_role('checkbox',name=re.compile('Đồ nam')).check()
        dialog.get_by_label('Khối lượng Đồ nam',exact=True).fill('2.5')
        dialog.get_by_label('Đơn giá Đồ nam',exact=True).fill('20000')
        dialog.get_by_label(re.compile('^Hình thức thanh toán')).select_option(label='Tiền mặt')
        expect(dialog.get_by_label(re.compile('^Số tiền'))).to_have_attribute('readonly','')
        card(dialog.get_by_role('region',name='Tổng tiền đơn đang tạo',exact=True),'TOTAL',50000)
        capture(page,'employee-create-sale-kg-mobile')
        page.set_viewport_size({'width':1440,'height':1100});capture(page,'employee-create-sale-kg-desktop')
        with page.expect_response(lambda response: '/api/command' in response.url and response.request.method=='POST') as saved:
            dialog.get_by_role('button',name='LƯU ĐƠN',exact=True).click()
        assert saved.value.ok, 'Save button backend command failed'
        expect(dialog).to_have_count(0,timeout=30000)
        card(own,'SALE_KG',100000);card(own,'TOTAL',230000)
        page.reload(wait_until='networkidle');card(own,'TOTAL',230000)
        expect(page.locator('body')).to_contain_text('Khách kiểm thử sale ký')
        expect(page.locator('body')).not_to_contain_text('BOB-SECRET')
        mark('Create-sale-kg button persists exactly 50000 VND and own shift totals survive reload')
        response=context.request.get(c['base']+'/api/integrations/warehouse/order-statistics',params={'storeId':'S01','period':c['date'][:7]},headers={'Authorization':'Bearer '+c['warehouseKey']})
        assert response.ok
        payload=response.json(); totals=payload.get('data',payload)['totals']
        assert totals['revenueByType']=={'NORMAL':200000,'SALE_KG':100000,'SALE_PIECE':30000}, totals
        assert totals['revenue']==330000 and totals['orders']==3,totals
        (out/'warehouse-totals.json').write_text(json.dumps(totals,ensure_ascii=False,indent=2))
        mark('Warehouse API reconciles the newly saved browser order without duplicate revenue')
        context.close()
        context=browser.new_context(viewport={'width':1440,'height':1100},timezone_id='Asia/Ho_Chi_Minh')
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        login(page,'manager.preview','store/overview')
        page.goto(c['base']+'/#/store/statistics',wait_until='networkidle')
        for mode in ['day','shift','month']:
            page.get_by_label('Xem thống kê theo',exact=True).select_option(mode)
            page.wait_for_load_state('networkidle')
            region=page.locator('.order-revenue-summary').first
            for kind,amount in [('NORMAL',200000),('SALE_KG',100000),('SALE_PIECE',30000),('TOTAL',330000)]:card(region,kind,amount)
            capture(page,'store-statistics-'+mode+'-desktop')
            mark('Store '+mode+' statistics match warehouse totals')
        page.get_by_role('button',name='Làm mới số liệu',exact=True).click()
        card(page.locator('.order-revenue-summary').first,'TOTAL',330000)
        page.set_viewport_size({'width':390,'height':844});capture(page,'store-statistics-month-mobile')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),'Store statistics overflow mobile viewport'
        page.set_viewport_size({'width':1440,'height':1100})
        page.get_by_label('Xem thống kê theo',exact=True).select_option('day')
        page.wait_for_load_state('networkidle')
        page.get_by_role('link',name=re.compile('^Xem đơn')).first.click()
        page.wait_for_url('**/store/orders?**',timeout=30000)
        assert 'date='+c['date'] in page.url and 'shiftId=AM' in page.url,page.url
        card(page.get_by_role('region',name='Doanh thu cả ca',exact=True).first,'TOTAL',330000)
        capture(page,'store-orders-shift-desktop')
        page.set_viewport_size({'width':390,'height':844});capture(page,'store-orders-shift-mobile')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),'Store orders overflow mobile viewport'
        mark('Refresh and Xem don retain correct date/shift filters and store orders reconcile on desktop/mobile')
        assert not errors,errors
        mark('No browser page errors')
    except Exception:
        capture(page,'failure')
        (out/'failure-page.txt').write_text(page.locator('body').inner_text())
        raise
    finally:
        (out/'result.json').write_text(json.dumps({'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2))
        browser.close()
