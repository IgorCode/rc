<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,maximum-scale=1" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <?php $dateCSS = date('YmdHis', filemtime('assets/css/app.css')); ?>
    <link rel="stylesheet" href="/assets/css/app-<?= $dateCSS; ?>.css" />
    <!-- <link rel="stylesheet" href="/assets/vendor/gridstack.js/1.1.1/gridstack.min.css" /> -->
    <link rel="dns-prefetch" href="https://www.googletagmanager.com" />
    <link rel="dns-prefetch" href="https://www.google-analytics.com" />

    <title>Modular RC - igorware.com</title>
    <meta name="description" content="Modular Bluetooth remote controller for RC cars" />
    <meta name="application-name" content="Modular RC" />
    <meta name="author" content="Igor Jerosimić" />
    <meta name="theme-color" content="#175676" />

    <link rel="canonical" href="https://rc.igorware.com/" />
    <link rel="icon" type="image/png" href="/assets/img/icon-032x032.png" />
    <link rel="apple-touch-icon" href="/assets/img/icon-256x256.png" />
    <link rel="image_src" href="/assets/img/icon-512x512.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="author" type="text/plain" href="https://igor.jerosimic.net/humans.txt" />

    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@graph": [{
            "@type": "Person",
            "@id": "https://igor.jerosimic.net/#person",
            "name": "Igor Jerosimić",
            "gender": "male",
            "url": "https://igor.jerosimic.net/",
            "image": "https://igor.jerosimic.net/static/img/igor-jerosimic.webp",
            "jobTitle": "Web developer",
            "sameAs": [
                "https://twitter.com/IgorJerosimic",
                "https://github.com/IgorCode",
                "https://stackoverflow.com/users/111433/igor-jerosimi%c4%87?tab=profile",
                "https://profiles.wordpress.org/x64igor/"
            ]
        }, {
            "@type": "WebApplication",
            "@id": "https://rc.igorware.com/#webapp",
            "url": "https://rc.igorware.com/",
            "inLanguage": "en",
            "name": "Modular RC",
            "description": "Modular Bluetooth remote controller for RC cars",
            "softwareVersion": "1.0.0",
            "offers": {
                "@type": "Offer",
                "price": "0"
            },
            "applicationCategory": "UtilitiesApplication",
            "about": {
                "@type": "Thing",
                "description": "modular rc, rc cars, bluetooth, controller"
            },
            "operatingSystem": "All",
            "browserRequirements": "Requires JavaScript. Requires HTML5.",
            "image": "/assets/img/icon-256x256.png",
            "author": {
                "@id": "https://igor.jerosimic.net/#person"
            },
            "publisher": {
                "@id": "https://igor.jerosimic.net/#person"
            },
            "isFamilyFriendly": "http://schema.org/True",
            "contentRating": "NR"
        }]
    }
    </script>
</head>
<body>
    <rc-app id="app" data-active-screen="connect">
        <status-bar>
            <button class="command" id="command-toggle-terminal">
                <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#terminal"></use></svg>
            </button>

            <span class="status-bar-title">Modular RC - <span id="bluetooth-device-name"></span><span id="firmware-version"></span></span>

            <span id="bluetooth-battery"></span>
            <button class="command" id="command-toggle-connect">
                <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#bluetooth"></use></svg>
            </button>
            <button class="command todo" id="command-toggle-options">
                <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#gear"></use></svg>
            </button>
        </status-bar>

        <app-screens>

            <app-screen id="screen-main">
                <screen-contents>
                    <!-- Built by controls.js from the car's manifest (grid + cells) -->
                    <controller-grid id="controller"></controller-grid>
                    <p class="rotate-hint">Turn the phone sideways to drive.</p>

                    <!-- Kept for later: the joystick and placeholder buttons of the earlier hard-coded layout
                        <div class="column direction-wrapper">
                            <div id="joystick">
                                <div id="direction-marks">
                                    <div class="direction-section direction-section-1"></div>
                                    <div class="direction-section direction-section-2"></div>
                                    <div class="direction-section direction-section-3"></div>
                                    <div class="direction-section direction-section-4"></div>
                                    <div id="direction-center"></div>
                                </div>

                                <div id="arrows"><div class="arrows-horizontal"></div></div>
                            </div>
                        </div>
                    -->
                </screen-contents>
            </app-screen>

            <app-screen id="screen-connect">
                <div class="row">
                    <div class="column connect-info">
                        <p>Press the big blue button and pick your car from the list.</p>
                        <p>Requirements:</p>
                        <ul>
                            <li>Chrome or Edge on Android, Windows, macOS or ChromeOS. Firefox, Safari and all browsers on iPhone and iPad do not support Web Bluetooth.</li>
                            <li>A Bluetooth Low Energy (BLE) module in the car, such as HM-10 or ESP32. Classic Bluetooth modules (HC-05, HC-06) do not work.</li>
                            <li>Bluetooth turned on. On Android 11 and older, Location must be on too.</li>
                        </ul>
                        <p>Each car sends its own controller layout when it connects.</p>
                        <p id="controls-help"></p>
                        <p>If the connection drops, the app reconnects to the same car automatically.</p>
                    </div>
                    <div class="column">
                        <button id="connect">
                            <span data-if-status="disconnected">Connect</span>
                            <span data-if-status="connecting">Connecting</span>
                            <span data-if-status="connected">Disconnect</span>
                             Bluetooth
                            <div class="spinner"></div>
                        </button>
                    </div>
                </div>
            </app-screen>

            <app-screen id="screen-error">
                <screen-contents>
                    <button class="command" id="command-close-error-screen">
                        <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#close"></use></svg>
                    </button>
                    <p id="error-message"></p>
                </screen-contents>
            </app-screen>

            <app-screen id="screen-terminal">
                <screen-contents>
                    <ul id="app-log"></ul>
                    <div class="custom-command-wrapper">
                        <input type="text" id="app-custom-command" maxlength="20" autocapitalize="off" spellcheck="false" placeholder="Custom command input" />
                        <button class="command" id="app-custom-command-send">Send</button>
                    </div>
                </screen-contents>
            </app-screen>

        </app-screens>
    </rc-app>

    <!-- <script src="/assets/vendor/nipplejs/0.8.5/nipplejs.min.js"></script> -->
    <!-- <script src="/assets/vendor/gridstack.js/1.1.1/gridstack.min.js"></script> -->
    <?php
    // Cache busting for ES modules: imports use plain URLs (./bluetooth.js), so the import map
    // sends each one to its timestamped URL, which .htaccess rewrites back to the real file
    $jsImports = [];
    foreach (glob('assets/js/*.js') as $jsFile) {
        if (preg_match('/\.min\.js$/', $jsFile) || basename($jsFile) === 'service-worker.js') {
            continue;
        }
        $jsImports['/' . $jsFile] = '/' . substr($jsFile, 0, -3) . '-' . date('YmdHis', filemtime($jsFile)) . '.js';
    }
    ?>
    <script type="importmap"><?= json_encode(['imports' => $jsImports], JSON_UNESCAPED_SLASHES); ?></script>
    <script type="module" src="<?= $jsImports['/assets/js/app.js']; ?>"></script>

    <script async src="https://www.googletagmanager.com/gtag/js?id=G-8MG5MVTBQX"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-8MG5MVTBQX');</script>
</body>
</html>
