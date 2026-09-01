# Мобильное приложение «Домофонная служба» (админка)

Expo-приложение для Android: заявки с сайта, ручное добавление, редактирование,
удаление, push-уведомления о новых заявках. Ходит в API на `https://www.obzor71.ru`.

## Сборка APK (EAS Build)

1. Установите CLI и войдите в аккаунт Expo:

   ```bash
   npm install -g eas-cli
   eas login
   ```

2. Первый раз — привяжите проект (создаст `extra.eas.projectId` в `app.json`):

   ```bash
   eas init
   ```

3. Соберите APK (профиль `preview` в `eas.json` собирает именно APK):

   ```bash
   eas build -p android --profile preview
   ```

   После сборки EAS покажет ссылку на скачивание `.apk` — установите файл на телефоны.

## Push-уведомления (важно для APK)

- В **Expo Go** push работает сразу, без настройки.
- В **собранном APK** для push на Android нужен Firebase (FCM):

  1. Создайте проект в [Firebase Console](https://console.firebase.google.com/).
  2. Добавьте Android-приложение с package name **`ru.obzor71.admin`**.
  3. Скачайте `google-services.json` и положите в эту папку (`mobile/google-services.json`).
  4. В `app.json` в секцию `android` добавьте строку:

     ```json
     "googleServicesFile": "./google-services.json"
     ```

  5. Пересоберите APK (`eas build -p android --profile preview`).

Сервер отправляет push через Expo Push API — ничего дополнительно на сервере
настраивать не нужно (токены устройств регистрируются приложением при входе).

## Как пользоваться

1. Установите APK, откройте, введите **общий пароль админки**.
2. Список заявок: обновляется потягиванием вниз, при новой заявке с сайта
   приходит push.
3. Нажмите на заявку — редактирование; удерживайте — удаление.
4. «+ Добавить» — ручное создание заявки.

## Разработка

```bash
npm install
npx expo start
```

Сканируйте QR-код в Expo Go. Адрес API задан в `src/api.ts` (`API_BASE`).
