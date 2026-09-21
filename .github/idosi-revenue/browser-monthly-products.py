from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect
import datetime, json, os, re, traceback

out = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'revenue-evidence'
root = 'http://127.0.0.1:4040'
current = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).strftime('%Y-%m')
history = json.loads((out / 'shift-history-fixture.json').read_text())['date'][:7]
empty = (datetime.date.fromisoformat(history + '-01') - datetime.timedelta(days=1)).strftime('%Y-%m')
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
        month = page.get_by_label('Tháng thống kê', exact=True)
        month.fill(current)
        def report_table(period):
            label = '/'.join(reversed(period.split('-')))
            return page.get_by_role('table', name=f'Thống kê mặt hàng • Tháng {label}', exact=True)
        table = report_table(current)
        expect(table.locator('tbody tr')).to_have_count(1)
        expect(table.locator('tbody tr td')).to_have_text(['Quần áo nam', '15', '≈ 5 kg'])
        expect(table.locator('thead th')).to_have_count(3)
        results.append('PASS: monthly report combines NORMAL and SALE_PIECE into 15 pieces / 5 estimated kg; 2.5 actual kg is not added to either')

        def monthly_response(response, period=current):
            parsed = urlparse(response.url)
            query = parse_qs(parsed.query)
            return parsed.path == '/api/order-summary' and query.get('period') == [period] and 'date' not in query and 'shiftId' not in query
        with page.expect_response(monthly_response) as refreshed:
            page.get_by_role('button', name='Làm mới số liệu', exact=True).click()
        assert refreshed.value.ok, refreshed.value.status
        data = refreshed.value.json()
        assert data['products']['weightByProduct'][0]['totalQuantity'] == 15, data
        warehouse = page.request.get(root + '/api/integrations/warehouse/v1/order-statistics', params={'storeId': 'S1', 'period': current}, headers={'X-IDOSI-Warehouse-Key': 'synthetic-warehouse-browser-testing-key'})
        assert warehouse.ok, warehouse.status
        assert warehouse.json()['products'] == data['products']
        (out / 'monthly-products-api.json').write_text(json.dumps(warehouse.json(), ensure_ascii=False, indent=2))
        for width in [320, 390, 430, 1280]:
            page.set_viewport_size({'width': width, 'height': 900})
            table.scroll_into_view_if_needed()
            expect(table.locator('tbody tr td')).to_have_text(['Quần áo nam', '15', '≈ 5 kg'])
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            fits = table.evaluate('''table => {
                const cells = [...table.querySelectorAll('th, td')];
                return cells.every(cell => cell.scrollWidth <= cell.clientWidth + 1)
                    && getComputedStyle(table).display === 'table'
                    && getComputedStyle(table.querySelector('thead')).display !== 'none';
            }''')
            assert fits, width
            page.locator('.product-quantity-report').screenshot(path=str(out / f'monthly-products-{width}.png'), animations='disabled')
        page.get_by_text('Xem khối lượng chi tiết theo loại bán', exact=True).click()
        expect(page.locator('.store-statistics-product-weight')).to_be_visible()
        expect(page.locator('.store-statistics-product-weight')).to_contain_text('2,5 kg')
        results.append('PASS: full-month request contains no date/shift filter; refresh and warehouse match; compact 3-column table fits 320/390/430/1280px and details remain available')

        month.fill(history)
        older = report_table(history)
        expect(older.locator('tbody tr td')).to_have_text(['Quần áo nam', '5', '≈ 1,667 kg'])
        assert not page.locator('.product-quantity-report details').evaluate('node => node.open')
        # The historical fixture has two legacy orders with no items. This used to hide
        # the footer even though all listed product lines had a valid estimate.
        footer = older.locator('tfoot')
        expect(footer).to_contain_text('≈ 1,667 kg')
        expect(footer).to_contain_text('Phần đã quy đổi')
        expect(footer).not_to_contain_text('Chưa đủ dữ liệu')
        report = page.locator('.product-quantity-report')
        expect(report.get_by_text(re.compile('chưa gồm 2 đơn chưa ghi nhận mặt hàng'))).to_be_visible()
        with page.expect_response(lambda response: monthly_response(response, history)) as history_refresh:
            page.get_by_role('button', name='Làm mới số liệu', exact=True).click()
        assert history_refresh.value.ok
        partial = history_refresh.value.json()
        weight = partial['products']['weight']
        assert weight['estimatedKg'] == 1.666667 and weight['actualKg'] == 2.5, weight
        assert weight['isComplete'] is False and weight['totalKg'] is None and weight['unclassifiedOrders'] == 2, weight
        history_api = page.request.get(root + '/api/integrations/warehouse/v1/order-statistics', params={'storeId': 'S1', 'period': history}, headers={'X-IDOSI-Warehouse-Key': 'synthetic-warehouse-browser-testing-key'})
        assert history_api.ok
        assert history_api.json()['products'] == partial['products']
        (out / 'monthly-products-partial-api.json').write_text(json.dumps(history_api.json(), ensure_ascii=False, indent=2))
        for width in [320, 390, 430, 1280]:
            page.set_viewport_size({'width': width, 'height': 900})
            footer.scroll_into_view_if_needed()
            expect(footer).to_contain_text('≈ 1,667 kg')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            assert footer.evaluate('(footer) => [...footer.querySelectorAll("th, td")].every(cell => cell.scrollWidth <= cell.clientWidth + 1)'), width
            report.screenshot(path=str(out / f'monthly-products-partial-{width}.png'), animations='disabled')
        results.append('PASS: incomplete historical month shows known estimated subtotal 1.666667 kg with separate warning for 2 unclassified orders; SQLite/API completeness stays false and totalKg null; mobile footer and warning remain visible')
        month.fill(empty)
        expect(page.get_by_text('Chưa có mặt hàng bán trong phạm vi đã chọn.', exact=True)).to_be_visible()
        expect(page.locator('.product-quantity-table')).to_have_count(0)
        month.fill(current)
        expect(table.locator('tbody tr td')).to_have_text(['Quần áo nam', '15', '≈ 5 kg'])
        expect(table.locator('tfoot')).not_to_contain_text('Phần đã quy đổi')
        expect(page.locator('.product-quantity-report').get_by_text(re.compile('chưa gồm 2 đơn'))).to_have_count(0)
        results.append('PASS: month switching isolates previous month (5 pieces), empty month, then restores current month (15 pieces); no stale or cumulative totals or partial warning')
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(out / 'monthly-products-failure.png'), full_page=True, animations='disabled')
        (out / 'monthly-products-failure-text.txt').write_text(page.locator('body').inner_text())
        results.append(traceback.format_exc())
        raise
    finally:
        (out / 'monthly-products-results.txt').write_text('\n'.join(results))
        browser.close()
