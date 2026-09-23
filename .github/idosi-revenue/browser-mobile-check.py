"""Mobile layout regression on the isolated SQLite fixture, never production."""
import json
import os
import re
import traceback
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'revenue-evidence'
OUT.mkdir(parents=True, exist_ok=True)
ROOT = 'http://127.0.0.1:4040'
WIDTHS = (320, 360, 390, 430)
results = []
failures = []

# Checked-in presentation sources only, to diagnose CSS cascade regressions.
with ZipFile(OUT / 'mobile-style-sources.zip', 'w', ZIP_DEFLATED) as archive:
    paths = list(Path('src').rglob('*.css')) + [Path(name) for name in (
        'src/components/UI.jsx', 'src/components/OrderItemSelector.jsx',
        'src/components/OrderRevenue.jsx', 'src/components/SearchableSelect.jsx',
        'src/components/OrderPaymentSummary.jsx', 'src/main.jsx',
        'src/pages/store/StoreV2Pages.jsx', 'src/pages/store/StoreStatisticsPage.jsx')]
    for path in paths:
        if path.is_file():
            archive.write(path, str(path))


def verify(condition, message, details=None):
    results.append({'pass': bool(condition), 'check': message, 'details': details})
    if not condition:
        failures.append(message)


def bounds(page, label):
    verify(page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), label + ': no page overflow')


def cards(page, selector, label, expected_count=4):
    expect(page.locator(selector).first).to_be_visible()
    data = page.locator(selector).evaluate_all('''elements => elements.map(el => {
        const b = el.getBoundingClientRect();
        const label = el.querySelector('.metric__label');
        const value = el.querySelector('.metric__body > strong');
        return {height:b.height, width:b.width, align:label && getComputedStyle(label).textAlign,
            labelSize:label && parseFloat(getComputedStyle(label).fontSize),
            valueSize:value && parseFloat(getComputedStyle(value).fontSize),
            fits:el.scrollWidth <= el.clientWidth + 1};
    })''')
    allowed_counts = expected_count if isinstance(expected_count, tuple) else (expected_count,)
    verify(len(data) in allowed_counts, label + ': all revenue cards remain', data)
    verify(all(x['height'] <= 112 and x['labelSize'] <= 13 and x['valueSize'] <= 19 for x in data), label + ': compact cards', data)
    verify(all(x['align'] in ('left', 'start') and x['fits'] for x in data), label + ': left-aligned cards without clipping', data)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = None
    try:
        def login(user):
            context = browser.new_context(viewport={'width': 1440, 'height': 1080})
            view = context.new_page()
            view.goto(ROOT + '/#/login', wait_until='networkidle')
            view.get_by_label('Tên đăng nhập').fill(user)
            view.get_by_label('Mật khẩu', exact=True).fill('Synthetic-password-2026')
            view.get_by_role('button', name='Đăng nhập', exact=True).click()
            view.wait_for_url(re.compile(r'.*#/(employee|store)/.*'), timeout=30000)
            return view

        page = login('test.employee')
        page.get_by_role('link', name='Đơn hàng', exact=True).click()
        page.get_by_role('button', name='TẠO ĐƠN HÀNG', exact=True).click()
        dialog = page.get_by_role('dialog')
        for width in WIDTHS:
            page.set_viewport_size({'width': width, 'height': 844})
            dialog.locator('.modal__body').evaluate('(el) => {el.scrollTop = 0}')
            page.screenshot(path=str(OUT / f'mobile-form-{width}.png'), full_page=True, animations='disabled')
            fields = dialog.locator('.form-grid > .field').evaluate_all('''els => els.map(el => {
                const label=el.querySelector('.field__label'), control=el.querySelector('input,select,[role="combobox"]');
                return {labelSize:parseFloat(getComputedStyle(label).fontSize),align:getComputedStyle(label).textAlign,
                    height:control && control.getBoundingClientRect().height, fits:el.scrollWidth <= el.clientWidth + 1};
            })''')
            verify(bool(fields) and all(x['labelSize'] <= 14 and x['align'] in ('left','start') and x['fits'] for x in fields), f'{width}: compact form labels', fields)
            verify(all(x['height'] is None or x['height'] <= 44 for x in fields), f'{width}: compact form controls', fields)
            selector = dialog.locator('.order-item-selector')
            selector.scroll_into_view_if_needed()
            names = selector.locator('.order-item-selector__choice').evaluate_all('''els => els.map(el => {
                const n=el.querySelector('.order-item-selector__name, strong');
                const code=el.querySelector('.order-item-selector__code');
                return {weight:parseFloat(getComputedStyle(n).fontWeight),size:parseFloat(getComputedStyle(n).fontSize),
                    codeVisible:!!code && getComputedStyle(code).display !== 'none' && code.getBoundingClientRect().height > 0,
                    rowHeight:el.closest('.order-item-selector__row').getBoundingClientRect().height};
            })''')
            verify(bool(names) and all(x['weight'] == 400 and x['size'] <= 14 and not x['codeVisible'] and x['rowHeight'] <= 68 for x in names), f'{width}: compact regular product names without codes', names)
            page.screenshot(path=str(OUT / f'mobile-products-{width}.png'), full_page=True, animations='disabled')
            bounds(page, f'{width}: create')
            verify(dialog.evaluate('''el => {
                const header=el.querySelector('header').getBoundingClientRect();
                const footer=el.querySelector('footer').getBoundingClientRect();
                const body=el.querySelector('.modal__body').getBoundingClientRect();
                return footer.bottom <= innerHeight + 1 && body.bottom <= footer.top + 1 && body.top >= header.bottom - 1;
            }'''), f'{width}: header/body/save footer do not overlap')
        dialog.get_by_role('combobox', name='Nghề nghiệp', exact=True).click()
        dialog.get_by_role('listbox').get_by_role('option', name='Nhân viên VP', exact=True).click()
        expect(dialog.get_by_role('combobox', name='Nghề nghiệp', exact=True)).to_contain_text('Nhân viên VP')
        dialog.get_by_role('tab', name=re.compile('Sale theo ký')).click()
        dialog.get_by_role('checkbox', name=re.compile('Quần áo nam')).check()
        dialog.get_by_label('Khối lượng Quần áo nam', exact=True).fill('2.5')
        dialog.get_by_label('Đơn giá Quần áo nam', exact=True).fill('20000')
        expect(dialog.get_by_role('region', name='Tổng tiền đơn đang nhập')).to_contain_text('50,000 đ')
        page.set_viewport_size({'width': 320, 'height': 568})
        dialog.locator('.order-item-selector__row.is-selected').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / 'mobile-sale-kg-320.png'), full_page=True, animations='disabled')
        bounds(page, '320: sale kg')
        dialog.get_by_role('button', name='Hủy', exact=True).click()
        for width in WIDTHS:
            page.set_viewport_size({'width': width, 'height': 844})
            cards(page, '.order-list-page > .order-revenue-summary > .metric', f'{width}: employee')
            bounds(page, f'{width}: employee')
            page.screenshot(path=str(OUT / f'mobile-employee-orders-{width}.png'), full_page=True, animations='disabled')
        page.context.close()
        page = login('test.store')
        page.get_by_role('link', name='Đơn hàng', exact=True).click()
        # Wait for the lazy route/data boundary, not the temporary loading skeleton.
        expect(page.locator('.store-orders-page > .order-revenue-summary')).to_contain_text('880,000 đ', timeout=30000)
        expect(page.locator('.order-table tbody tr').first).to_be_visible()
        for width in WIDTHS:
            page.set_viewport_size({'width': width, 'height': 844})
            cards(page, '.store-orders-page > .order-revenue-summary > .metric', f'{width}: store', 5)
            bounds(page, f'{width}: store')
            cells = page.locator('.order-table tbody tr').first.locator('td[data-label]').evaluate_all('''els => els.map(el => ({
                align:getComputedStyle(el).textAlign, font:parseFloat(getComputedStyle(el).fontSize),
                fits:el.scrollWidth <= el.clientWidth + 1
            }))''')
            verify(bool(cells) and all(x['align'] in ('left','start') and x['font'] <= 14 and x['fits'] for x in cells), f'{width}: compact left-aligned order details', cells)
            page.screenshot(path=str(OUT / f'mobile-store-orders-{width}.png'), full_page=True, animations='disabled')
        page.set_viewport_size({'width': 1440, 'height': 1080})
        page.get_by_role('link', name='Số liệu thống kê', exact=True).click()
        for mode in ('month', 'day', 'shift'):
            page.get_by_label('Xem thống kê theo', exact=True).select_option(mode)
            expect(page.locator('.store-statistics-page .order-revenue-summary')).to_be_visible()
            for width in (320, 390):
                page.set_viewport_size({'width': width, 'height': 844})
                cards(page, '.store-statistics-page .order-revenue-summary > .metric', f'{width}: statistics {mode}', (4, 5))
                bounds(page, f'{width}: statistics {mode}')
            page.screenshot(path=str(OUT / f'mobile-statistics-{mode}.png'), full_page=True, animations='disabled')
        if failures:
            raise AssertionError('\n'.join(failures))
        print(f'PASS: {len(results)} compact mobile checks at 320/360/390/430px; existing revenue flow unchanged')
    except Exception:
        if page:
            page.screenshot(path=str(OUT / 'mobile-failure.png'), full_page=True, animations='disabled')
        (OUT / 'mobile-failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        (OUT / 'mobile-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        browser.close()
