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

            <button class="command todo" id="command-toggle-options">
                <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#gear"></use></svg>
            </button>
            <button class="command" id="command-toggle-connect">
                <svg class="icon" width="14" height="14"><use xlink:href="/assets/img/app-icons.svg?#bluetooth"></use></svg>
            </button>

            Modular RC - <span id="bluetooth-device-name"></span>
        </status-bar>

        <app-screens>

            <app-screen id="screen-main">
                <screen-contents>
<!-- <div class="display-wrapper grid-stack">
    <div class="display grid-stack-item" id="display-direction"><div class="grid-stack-item-content">—</div></div>
    <div class="display grid-stack-item" id="display-1"><div class="grid-stack-item-content">—</div></div>
    <div class="display grid-stack-item" id="display-2"><div class="grid-stack-item-content">—</div></div>
    <div class="display grid-stack-item" id="display-3"><div class="grid-stack-item-content">—</div></div>
    <div class="display grid-stack-item" id="display-4"><div class="grid-stack-item-content">>—</div></div>
</div> -->

                    <div class="display-wrapper">
                        <div class="display" id="display-direction">—</div>
                        <div class="display" id="display-1">—</div>
                        <div class="display" id="display-2">—</div>
                        <div class="display" id="display-3">—</div>
                        <div class="display" id="display-4">—</div>
                    </div>

                    <div class="row">
                        <command-direction class="command-direction command-direction-vertical">
                            <button id="command-direction-forward" aria-label="Direction forward"></button>
                            <button id="command-direction-backward" aria-label="Direction backward"></button>
                        </command-direction>
                        <!-- <div class="column direction-wrapper">
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
                        </div> -->
                        <div class="column command-wrapper">
                            <div class="command-speed-picker">
                                <div class="display" id="display-speed"></div>
                                <input type="range" value="1" min="1" max="10" step="1" class="slider" list="tickmarks" id="speed-picker" aria-label="Change speed" />
                                <datalist id="tickmarks">
                                    <option value="1" label="10%"></option>
                                    <option value="2"></option>
                                    <option value="3"></option>
                                    <option value="4"></option>
                                    <option value="5" label="50%"></option>
                                    <option value="6"></option>
                                    <option value="7"></option>
                                    <option value="8"></option>
                                    <option value="9"></option>
                                    <option value="10" label="100%"></option>
                                </datalist>
                            </div>
                            <div id="commands">
                                <command-direction class="command-direction command-direction-horizontal">
                                    <button id="command-direction-left" aria-label="Direction left"></button>
                                    <button id="command-direction-right" aria-label="Direction right"></button>
                                </command-direction>

                                <button class="command" id="command-1">A</button>
                                <button class="command" id="command-2">L</button>
                                <button class="command" id="command-3">H</button>
                                <input type="color" class="command command-type-rgb" id="command-4" value="#ffffff" />

                                <!-- <button class="command todo" id="command-5">—</button>
                                <button class="command todo" id="command-6">—</button>
                                <button class="command todo" id="command-7">—</button>
                                <button class="command todo" id="command-8">—</button>

                                <button class="command todo" id="command-9">—</button>
                                <button class="command todo" id="command-10">—</button>
                                <button class="command todo" id="command-11">—</button>
                                <button class="command todo" id="command-12">—</button> -->

                                <!-- <button class="command todo" id="command-13">—</button>
                                <button class="command todo" id="command-14">—</button>
                                <button class="command todo" id="command-15">—</button>
                                <button class="command todo" id="command-16">—</button> -->
                                <!-- TODO: Work in progress -->
                            </div>
                        </div>
                    </div>
                </screen-contents>
            </app-screen>

            <app-screen id="screen-connect">
                <div class="row">
                    <div class="column">
                        <p>Press the big blue button to start the connection.</p>
                        <p>
                            NOTES:
                            <br/>Web Bluetooth works only with Bluetooth v4
                            <br/>Minimum Chrome v55
                        </p>
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
    <?php $dateJS = date('YmdHis', filemtime('assets/js/app.js')); ?>
    <script src="/assets/js/app-<?= $dateJS; ?>.js"></script>

    <script async src="https://www.googletagmanager.com/gtag/js?id=G-8MG5MVTBQX"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-8MG5MVTBQX');</script>
</body>
</html>
