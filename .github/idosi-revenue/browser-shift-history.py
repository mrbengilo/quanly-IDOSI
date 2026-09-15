from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
import json, os, re, traceback

out = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'revenue-evidence'
fixture = json.loads((out / 'shift-history-fixture.json').read_text())
date = fixture['date']
label_date = '/'.join(reversed(date.split('-')))
root = 'http://127.0.0.1:4040'
shift_key = 'ca tối:17:00:22:00'
results = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(root + '/#/login', wait_until='networkidle')
        page.get_by_label('Tên đăng nhập').fill('test.store')
        page.get_by_label('Mật khẩu', exact=True).fill('Synthetic-password-2026')
        page.get_by_role('button', name='Đăng nhập', exact=True).click()
        page.wait_for_url(re.compile(r'.*#/store/.*'), timeout=30000)
        page.get_by_role('link', name='Số liệu thống kê', exact=True).click()
        page.get_by_label('Xem thống kê theo', exact=True).select_option('month')
        page.get_by_label('Tháng thống kê', exact=True).fill(date[:7])
        summary = page.locator('.store-statistics-page .order-revenue-summary')
        expect(summary).to_contain_text('240,000 đ')
        page.get_by_role('button', name='Xem ngày', exact=True).first.click()
        expect(page.get_by_label('Ngày thống kê', exact=True)).to_have_value(date)
        expect(summary).to_contain_text('240,000 đ')
        evening_row = page.get_by_role('row').filter(has_text='Ca tối')
        expect(evening_row).to_have_count(1)
        evening_row.get_by_role('button', name='Xem ca', exact=True).click()
        choice = page.get_by_label('Ca thống kê', exact=True)
        expect(choice).to_have_value(shift_key)
        evening = page.get_by_role('region', name=f'Doanh thu Ca tối • {label_date}', exact=True)
        for amount in ['100,000 đ', '50,000 đ', '30,000 đ', '180,000 đ']:
            expect(evening).to_contain_text(amount)
        expect(evening).not_to_contain_text('240,000 đ')
        values = choice.locator('option').evaluate_all('(options) => options.map(option => option.value)')
        assert 'EVENING' not in values, values
        assert 'RETIRED-AM' in values and 'chưa gắn ca::' in values, values
        results.append('PASS: month -> historical day -> missing-ID evening; UI uses snapshot key, not recreated active shift ID or day total')

        choice.select_option('RETIRED-AM')
        expect(page.get_by_role('region', name=f'Doanh thu Ca sáng • {label_date}', exact=True)).to_contain_text('43,000 đ')
        choice.select_option('chưa gắn ca::')
        expect(page.get_by_role('region', name=f'Doanh thu Chưa gắn ca • {label_date}', exact=True)).to_contain_text('17,000 đ')
        choice.select_option(shift_key)
        expect(evening).to_contain_text('180,000 đ')

        def is_evening_response(response):
            parsed = urlparse(response.url)
            params = parse_qs(parsed.query)
            return parsed.path == '/api/order-summary' and params.get('date') == [date] and params.get('shiftId') == [shift_key]

        with page.expect_response(is_evening_response) as refreshed:
            page.get_by_role('button', name='Làm mới số liệu', exact=True).click()
        assert refreshed.value.ok, refreshed.value.status
        api_summary = refreshed.value.json()
        assert api_summary['totals']['revenue'] == 180000, api_summary
        expect(evening).to_contain_text('180,000 đ')
        warehouse = page.request.get(root + '/api/integrations/warehouse/v1/order-statistics', params={
            'storeId': 'S1', 'period': date[:7], 'date': date, 'shiftId': shift_key,
        }, headers={'X-IDOSI-Warehouse-Key': 'synthetic-warehouse-browser-testing-key'})
        assert warehouse.ok, warehouse.status
        data = warehouse.json()
        assert data['totals'] == api_summary['totals'], data
        assert data['products'] == api_summary['products'], data
        assert data['totals']['revenueByType'] == {'NORMAL': 100000, 'SALE_KG': 50000, 'SALE_PIECE': 30000}, data
        (out / 'shift-history-warehouse.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
        results.append('PASS: retired ID 43000, unbound 17000, evening 180000; refresh and authenticated warehouse API exactly match all three revenues and quantities')

        for width in [320, 390, 1280]:
            page.set_viewport_size({'width': width, 'height': 900})
            evening.scroll_into_view_if_needed()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            expect(evening).to_contain_text('180,000 đ')
            page.screenshot(path=str(out / f'shift-history-{width}.png'), full_page=True, animations='disabled')
        results.append('PASS: historical shift summary on mobile 320/390 and desktop 1280 without horizontal overflow')
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(out / 'shift-history-failure.png'), full_page=True, animations='disabled')
        (out / 'shift-history-failure-text.txt').write_text(page.locator('body').inner_text())
        results.append(traceback.format_exc())
        raise
    finally:
        (out / 'shift-history-results.txt').write_text('\n'.join(results))
        browser.close()
