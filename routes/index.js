import express from "express";
export const router = express.Router();

router.post("/connected", (req, res) => {
  // {
  //   raw: {
  //     device: {
  //       platform: "macos",
  //       appName: "telegram-wallet",
  //       appVersion: "1",
  //       maxProtocolVersion: 2,
  //       features: [
  //         {
  //           name: "SendTransaction",
  //           maxMessages: 255,
  //           extraCurrencySupported: true,
  //         },
  //         { name: "SignData", types: ["text", "binary", "cell"] },
  //       ],
  //     },
  //     provider: "http",
  //     account: {
  //       address:
  //         "0:b7afd1f737075364fb35d0cf57cb37ddf2bf77418e9d13ba5319e80a19fe799a",
  //       chain: "-239",
  //       walletStateInit:
  //         "te6cckECFgEAArEAAgE0ARUBFP8A9KQT9LzyyAsCAgEgAw4CAUgEBQLc0CDXScEgkVuPYyDXCx8gghBleHRuvSGCEHNpbnS9sJJfA+CCEGV4dG66jrSAINchAdB01yH6QDD6RPgo+kQwWL2RW+DtRNCBAUHXIfQFgwf0Dm+hMZEw4YBA1yFwf9s84DEg10mBAoC5kTDgcOIREAIBIAYNAgEgBwoCAW4ICQAZrc52omhAIOuQ64X/wAAZrx32omhAEOuQ64WPwAIBSAsMABezJftRNBx1yHXCx+AAEbJi+1E0NcKAIAAZvl8PaiaECAoOuQ+gLAEC8g8BHiDXCx+CEHNpZ2668uCKfxAB5o7w7aLt+yGDCNciAoMI1yMggCDXIdMf0x/TH+1E0NIA0x8g0x/T/9cKAAr5AUDM+RCaKJRfCtsx4fLAh98Cs1AHsPLQhFEluvLghVA2uvLghvgju/LQiCKS+ADeAaR/yMoAyx8BzxbJ7VQgkvgP3nDbPNgRA/btou37AvQEIW6SbCGOTAIh1zkwcJQhxwCzji0B1yggdh5DbCDXScAI8uCTINdKwALy4JMg1x0GxxLCAFIwsPLQiddM1zkwAaTobBKEB7vy4JPXSsAA8uCT7VXi0gABwACRW+Dr1ywIFCCRcJYB1ywIHBLiUhCx4w8g10oSExQAlgH6QAH6RPgo+kQwWLry4JHtRNCBAUHXGPQFBJ1/yMoAQASDB/RT8uCLjhQDgwf0W/LgjCLXCgAhbgGzsPLQkOLIUAPPFhL0AMntVAByMNcsCCSOLSHy4JLSAO1E0NIAURO68tCPVFAwkTGcAYEBQNch1woA8uCO4sjKAFjPFsntVJPywI3iABCTW9sx4ddM0ABRgAAAAD///4jWT/1a/ou7yFrvJTqsVkGS8DYfwHalDXgLBy0T7FNcLqBF7ZuV",
  //       publicKey:
  //         "ac9ffab5fd177790b5de4a7558ac8325e06c3f80ed4a1af0160e5a27d8a6b85d",
  //     },
  //     name: "Wallet",
  //     appName: "telegram-wallet",
  //     imageUrl: "https://wallet.tg/images/logo-288.png",
  //     aboutUrl: "https://wallet.tg/",
  //     platforms: ["ios", "android", "macos", "windows", "linux"],
  //     bridgeUrl: "https://walletbot.me/tonconnect-bridge/bridge",
  //     universalLink: "https://t.me/wallet?attach=wallet",
  //     openMethod: "universal-link",
  //   },
  //   wallet:
  //     "0:b7afd1f737075364fb35d0cf57cb37ddf2bf77418e9d13ba5319e80a19fe799a",
  //   href: "https://lolkekcheburek.click/?tgWebAppStartParam=WzAsIDE5MCwgInRnZGFuYTAiLCAiRnVsbCIsIDMsIDE3NTY3MTM2MjE4NDZd#tgWebAppData=user%3D%257B%2522id%2522%253A8475576567%252C%2522first_name%2522%253A%2522tomi%2522%252C%2522last_name%2522%253A%2522%2522%252C%2522username%2522%253A%2522tomi4555%2522%252C%2522language_code%2522%253A%2522zh-hans%2522%252C%2522allows_write_to_pm%2522%253Atrue%252C%2522photo_url%2522%253A%2522https%253A%255C%252F%255C%252Ft.me%255C%252Fi%255C%252Fuserpic%255C%252F320%255C%252FE_RNASONQCzHcxKX1O6YzCldo-fPIxJatA2KCblU0vJ_8iyvn4aZpUuEAeAQvRYY.svg%2522%257D%26chat_instance%3D7407771585304251863%26chat_type%3Dprivate%26start_param%3DWzAsIDE5MCwgInRnZGFuYTAiLCAiRnVsbCIsIDMsIDE3NTY3MTM2MjE4NDZd%26auth_date%3D1756730618%26signature%3DMasFMbh6-wR6lBPQPJ2CMLGV3WqAaQ5GI4D6dMhdjahpM4qWevn1ZQrj5SqG0V8pt4H2th99PSibcZ7Ho3zoBA%26hash%3D64e1bdce7cda205486ace3387d77be248497080387df001f1716d836ddfdc8c0&tgWebAppVersion=9.1&tgWebAppPlatform=macos&tgWebAppThemeParams=%7B%22secondary_bg_color%22%3A%22%23efeff3%22%2C%22link_color%22%3A%22%232481cc%22%2C%22section_header_text_color%22%3A%22%236d6d71%22%2C%22header_bg_color%22%3A%22%23efeff3%22%2C%22button_color%22%3A%22%232481cc%22%2C%22destructive_text_color%22%3A%22%23ff3b30%22%2C%22bg_color%22%3A%22%23ffffff%22%2C%22bottom_bar_bg_color%22%3A%22%23e4e4e4%22%2C%22section_separator_color%22%3A%22%23eaeaea%22%2C%22section_bg_color%22%3A%22%23ffffff%22%2C%22subtitle_text_color%22%3A%22%23999999%22%2C%22hint_color%22%3A%22%23999999%22%2C%22button_text_color%22%3A%22%23ffffff%22%2C%22accent_text_color%22%3A%22%232481cc%22%2C%22text_color%22%3A%22%23000000%22%7D",
  // };
  console.log("connected 请求内容", req);
  // 执行脚本
  res.status(200).json({
    success: true,
    message: "连接成功",
    data: {
      status: "connected",
      timestamp: new Date().toISOString(),
    },
  });
});

router.post("/disconnect", (req, res) => {
  console.log("disconnect 请求内容", req);
  // 执行脚本
  res.status(200).json({
    success: true,
    message: "连接成功",
    data: {
      status: "connected",
      timestamp: new Date().toISOString(),
    },
  });
});

router.post("/accept", (req, res) => {
  console.log("accept 请求内容", req);
  // 执行脚本
  res.status(200).json({
    success: true,
    message: "连接成功",
    data: {
      status: "connected",
      timestamp: new Date().toISOString(),
    },
  });
});

router.post("/reject", (req, res) => {
  console.log("reject 请求内容", req);
  // 执行脚本
  res.status(200).json({
    success: true,
    message: "连接成功",
    data: {
      status: "connected",
      timestamp: new Date().toISOString(),
    },
  });
});