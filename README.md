<div align="center">

# claude-code-player

**Что сейчас играет — прямо в Claude Code.**

Трек из любого приложения: Spotify, Яндекс Музыка, ВК, SoundCloud, Telegram, скачанная музыка.

![version](https://img.shields.io/badge/version-1.1.5-d97757)
![platform](https://img.shields.io/badge/platform-Windows-3d3c38)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-3d3c38)
![license](https://img.shields.io/badge/license-MIT-3d3c38)

<img src="assets/preview.svg" alt="Lil Peep — Gym Class над полем ввода и рядом с моделью" width="820">

</div>

## Что умеет

- Показывает автора и название трека над полем ввода: слева, по центру или справа.
- Дублирует их строчкой внизу, рядом с моделью.
- Эквалайзер `▂▅▃` прыгает, пока трек играет, и замирает на паузе, а текст тускнеет.
- Когда ничего не играет, плеер исчезает.
- Чистит названия от мусора вроде `(Official Video)` и разбирает браузерное «Артист - Трек».
- Все настройки меняются кнопками в `/player` и запоминаются между сессиями.

Трек берётся из системных медиасессий Windows, тех же, что показывает плашка громкости. Поэтому плеер видит любое приложение, которое сообщает туда, что играет, без отдельной настройки под каждый сервис.

## Установка

**В приложении Claude:** нажми **+** рядом с полем ввода → **Plugins** → **Add marketplace**, введи `playsin333/claude-code-player`, затем **Add plugin** → `now-playing`.

**В терминале:**

```
/plugin install now-playing --marketplace playsin333/claude-code-player
```

Нужна Windows 10 или 11 со встроенным Windows PowerShell (`powershell.exe`, он есть в системе по умолчанию).

## Настройки

Напиши `/player` — в чате появится панель с кнопками:

```
Играет: Lil Peep — Gym Class

Над полем ввода   [выкл] [слева] [по центру] [справа]
Размер текста     [маленький] [обычный]
Внизу             [выкл] [вкл]
```

То же самое можно сделать текстом:

| Команда | Что делает |
| --- | --- |
| `/player top off\|left\|center\|right` | полоса над полем ввода |
| `/player size small\|normal` | размер её текста |
| `/player bottom off\|on` | строчка внизу, у модели |
| `/player off` / `/player on` | выключить или включить всё |
| `/player debug` | что происходит внутри, для поиска багов |

## Как это устроено

`helper/now-playing.ps1` раз в полсекунды спрашивает у Windows текущую медиасессию и при каждом изменении печатает одну строку JSON. Мод (`hooks/register.tsx`) запускает скрипт, читает его вывод и рисует плеер. Данные никуда не отправляются, и модель их не видит.

```
helper/now-playing.ps1   читает трек из Windows
hooks/register.tsx       рисует плеер и отвечает на /player
types/index.d.ts         типы состояния плеера
tests/                   тесты (claude plugin test .)
```

## Планы

- **1.2** — кнопки «назад / пауза / вперёд» и время трека, с переключателем в панели.
- **2.0** — совместимость с плагинами, которые тоже рисуют над полем ввода; macOS и Linux.

История изменений — в [CHANGELOG.md](CHANGELOG.md).

Лицензия — [MIT](LICENSE).
