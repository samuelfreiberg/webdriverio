---
id: coverage
title: Coverage
---

اجراکننده مرورگر WebdriverIO از گزارش پوشش کد با استفاده از [`istanbul`](https://istanbul.js.org/)پشتیبانی می کند. The testrunner will automatically instrument your code and capture code coverage for you.

## تنظیم

برای فعال کردن گزارش پوشش کد، آن را از طریق پیکربندی اجراکننده مرورگر WebdriverIO فعال کنید، به عنوان مثال:

```js title=wdio.conf.js
export const config = {
    // ...
    runner: ['browser', {
        preset: process.env.WDIO_PRESET,
        coverage: {
            enabled: true
        }
    }],
    // ...
}
```

تمام [گزینه های پوشش](/docs/runner#coverage-options)را بررسی کنید تا نحوه صحیح پیکربندی آن را بیاموزید.

## نادیده گرفتن کد

ممکن است بخش‌هایی از پایگاه کد شما وجود داشته باشد که بخواهید به طور هدفمند از ردیابی پوشش حذف کنید، برای این کار می‌توانید از نکات زیر استفاده کنید:

- `/* istanbul ignore if */`: دستور if بعدی را نادیده بگیر.
- `/* istanbul ignore else */`: نادیده گرفتن قسمت else یک دستور if.
- `/* istanbul ignore next */`: چیز بعدی در کد را نادیده بگیر ( functions, if statements, classes, یا هر چیز دیگر).
- `/* istanbul ignore file */`: کل فایل را نادیده بگیر (این کد باید در بالای فایل قرار گیرد).

:::info

توصیه می شود فایل های تست خود را از گزارش پوشش حذف کنید، زیرا ممکن است باعث ایجاد خطا شود، به عنوان مثال هنگام فراخوانی `execute` یا `executeAsync`. اگر دوست دارید آنها را در گزارش خود نگه دارید، اطمینان حاصل کنید که ابزارسازی آن را از طریق زیر غیر فعال کرده اید:

```ts
await browser.execute(/* istanbul ignore next */() => {
    // ...
})
```

:::
