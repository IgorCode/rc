import stylistic from "@stylistic/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [
    {
        ignores: [
            "node_modules/*",
        ],
    },
    ...compat.extends("eslint:recommended"),
    {
        plugins: {
            "@stylistic": stylistic,
            jsdoc: jsdoc,
        },

        settings: {
            jsdoc: {
                // NOTE: jsdoc/check-types only rewrites capitalized natives (Number -> number)
                // out of the box, so made-up type names pass silently unless listed here
                preferredTypes: {
                    bool: "boolean",
                    int: "number",
                    integer: "number",
                },
            },
        },

        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
            },

            ecmaVersion: 2022,
            sourceType: "script",
        },

        rules: {
            "camelcase": ["off"],
            "curly": ["error"],
            "eqeqeq": ["error"],
            "no-alert": ["error"],
            "no-console": ["error", {
                allow: ["log", "error"],
            }],
            "no-empty-function": ["error"],
            "no-eval": ["error"],
            "no-redeclare": ["error", {
                builtinGlobals: false,
            }],
            "prefer-object-has-own": ["error"],
            "strict": ["error", "global"],


            // stylistic
            "@stylistic/array-bracket-spacing": ["error", "never"],
            "@stylistic/comma-style": ["error", "last"],
            "@stylistic/comma-spacing": ["error", {
                before: false,
                after: true,
            }],
            "@stylistic/indent": ["error", "tab", {
                SwitchCase: 1,
            }],
            "@stylistic/linebreak-style": ["error", "unix"],
            "@stylistic/newline-per-chained-call": ["error"],
            "@stylistic/no-extra-semi": ["error"],
            // "no-multi-spaces": ["error", {
            // 	"ignoreEOLComments": true
            // }],
            "@stylistic/no-trailing-spaces": ["error"],
            "@stylistic/no-whitespace-before-property": ["error"],
            "@stylistic/object-curly-newline": ["off", {
                multiline: true,
            }],
            "@stylistic/object-curly-spacing": ["error", "never"],
            "@stylistic/one-var-declaration-per-line": ["error", "always"],
            "@stylistic/semi": ["error", "always"],
            "@stylistic/semi-spacing": ["error", {
                before: false,
                after: true,
            }],
            "@stylistic/space-before-function-paren": ["error", {
                anonymous: "always",
                named: "never",
            }],

            // TODO: replace "brace-rules/brace-on-same-line" (was: ["warn", {FunctionDeclaration: "never"}],
            // i.e. opening brace on its own line for function declarations, same line elsewhere).
            // eslint-plugin-brace-rules was removed: it is unmaintained and crashes on ESLint 10
            // ("context.getSourceCode is not a function"). @stylistic/brace-style is not a drop-in —
            // it applies one style to every node type and cannot special-case FunctionDeclaration.

            // jsdoc
            "jsdoc/check-param-names": "error",
            "jsdoc/check-property-names": "error",
            "jsdoc/check-types": "error",
            "jsdoc/no-blank-blocks": "error",
            "jsdoc/require-description": "error",
            "jsdoc/require-jsdoc": "error",
            "jsdoc/require-param": "error",
            "jsdoc/require-param-name": "error",
            "jsdoc/require-param-type": "error",
            "jsdoc/require-returns": "error",
        },
    },
    {
        files: ["**/*.cjs"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
            sourceType: "commonjs",
        },
    }
];
