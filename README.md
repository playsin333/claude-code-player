# claude-code-player

Now-playing mod for Claude Code: shows the current track (artist — title) from any app via the OS media session — Spotify, Yandex Music, VK, SoundCloud, Telegram, local files.

Мод для Claude Code, который показывает, что сейчас играет. Трек берётся из системных медиасессий Windows, поэтому подходит любое приложение, которое туда сообщает: Spotify, Яндекс Музыка, Telegram, плееры для скачанной музыки, а также браузер (ВК, SoundCloud, YouTube).

## Как выглядит

Над полем ввода, по центру:

```
                  ▂▅▃  Kendrick Lamar — Not Like Us
```

И строчкой рядом с выбором модели:

```
 ▂▅▃  Kendrick Lamar — Not Like Us
```

Пока трек играет, эквалайзер прыгает. На паузе он замирает (`▁▁▁`), а текст тускнеет. Если ничего не играет, плеер не показывается.

## Установка

В приложении Claude: нажми **+** рядом с полем ввода → **Plugins** → **Add marketplace**, введи `playsin333/claude-code-player`, затем **Add plugin** → `now-playing`.

В терминале:

```
/plugin install now-playing --marketplace playsin333/claude-code-player
```

Пока работает только на Windows: нужен встроенный Windows PowerShell (`powershell.exe`).

## Команды

```
/player        что сейчас играет, текущий режим и подсказка
/player bar    плеер над полем ввода
/player line   строчка возле модели
/player both   оба сразу (по умолчанию)
/player off    выключить
```

Выбранный режим запоминается между сессиями.

## Как это устроено

`helper/now-playing.ps1` раз в полсекунды спрашивает у Windows текущую медиасессию и при каждом изменении печатает одну строку JSON. Мод (`hooks/register.tsx`) запускает этот скрипт, читает его вывод и рисует плеер. Никуда в сеть данные не уходят.
