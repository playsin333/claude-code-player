<div align="center">

# claude-code-player

**Что сейчас играет — прямо в Claude Code.**

Трек из любого приложения: Spotify, Яндекс Музыка, ВК, SoundCloud, Telegram, скачанная музыка.

![version](https://img.shields.io/badge/version-1.0.0-d97757)
![platform](https://img.shields.io/badge/platform-Windows-3d3c38)
![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-3d3c38)
![license](https://img.shields.io/badge/license-MIT-3d3c38)

<img src="assets/preview.svg" alt="Lil Peep — Gym Class над полем ввода и рядом с моделью" width="820">

</div>

## Что умеет

- Показывает автора и название трека над полем ввода, по центру.
- Дублирует их строчкой внизу, рядом с выбором модели.
- Эквалайзер `▂▅▃` прыгает, пока трек играет, и замирает на паузе, а текст тускнеет.
- Когда ничего не играет, плеер исчезает.
- Чистит названия от мусора вроде `(Official Video)` и разбирает браузерное «Артист - Трек».
- Режим показа запоминается между сессиями.

Трек берётся из системных медиасессий Windows, тех же, что показывает плашка громкости. Поэтому плеер видит любое приложение, которое сообщает туда, что играет, без отдельной настройки под каждый сервис.

## Установка

**В приложении Claude:** нажми **+** рядом с полем ввода → **Plugins** → **Add marketplace**, введи `playsin333/claude-code-player`, затем **Add plugin** → `now-playing`.

**В терминале:**

```
/plugin install now-playing --marketplace playsin333/claude-code-player
```

Нужна Windows 10 или 11 со встроенным Windows PowerShell (`powershell.exe`, он есть в системе по умолчанию).

## Команды

| Команда | Что делает |
| --- | --- |
| `/player` | что сейчас играет, текущий режим и подсказка |
| `/player bar` | плеер над полем ввода |
| `/player line` | строчка рядом с моделью |
| `/player both` | оба сразу (по умолчанию) |
| `/player off` | выключить |

## Как это устроено

`helper/now-playing.ps1` раз в полсекунды спрашивает у Windows текущую медиасессию и при каждом изменении печатает одну строку JSON. Мод (`hooks/register.tsx`) запускает скрипт, читает его вывод и рисует плеер. Данные никуда не отправляются, и модель их не видит.

```
helper/now-playing.ps1   читает трек из Windows
hooks/register.tsx       рисует плеер и отвечает на /player
types/index.d.ts         типы состояния плеера
tests/                   тесты (claude plugin test .)
```

## Планы

- **1.1** — кнопки «назад / пауза / вперёд» при наведении, три размера, выравнивание, время трека.
- **2.0** — конструктор в `/player settings`: сам собираешь, что и где показывать.
- Linux и macOS.

История изменений — в [CHANGELOG.md](CHANGELOG.md).

Лицензия — [MIT](LICENSE).
