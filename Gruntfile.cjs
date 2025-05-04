'use strict';

module.exports = function (grunt)
{
    // Timing
    require('time-grunt')(grunt);

    // Just in time task loader (replaces grunt.loadNpmTasks)
    require('jit-grunt')(grunt);

    // Project configuration
    grunt.initConfig({
        // Metadata
        pkg: grunt.file.readJSON('package.json'),

        dirs: {
            src : 'src',
            assets: 'src/assets',
            vendor: 'src/assets/vendor'
        },

        // Task configurations
        jsonlint: {
            all: {
                src: ['*.json', '<%= dirs.src %>/**/*.json', '!<%= dirs.vendor %>']
            }
        },
        eslint: {
            gruntfile: {
                src: 'Gruntfile.cjs'
            },
            js: {
                src: [
                    '<%= dirs.assets %>/js/**/*.js',
                    '!<%= dirs.assets %>/js/**/*.min.js'
                ]
            }
        },
        htmllint: {
            options: {
                force: true,
                htmllintrc: true
                // "input-req-label": true, // Doesn't recognize aria-label as replacement
                // "raw-ignore-regex": /<style>[^]*?<\/style>/,
                // "spec-char-escape": true, // Makes an error for > within style tag
            },
            all: {
                src: [
                    '<%= dirs.src %>/**/*.html'
                ]
            }
        },

        uglify: {
            options: {
                beautify: false,
                compress: {
                    sequences: false
                },
                mangle: false,
                preserveComments: false
            },
            all: {
                expand: true,
                cwd: '<%= dirs.assets %>/js/',
                src: [
                    'app.js',
                    'service-worker.js'
                ],
                dest: '<%= dirs.assets %>/js/',
                ext: '.min.js'
            }
        },

        notify: {
            done: {
                options: {
                    message: 'Done!'
                }
            }
        },

        watch: {
            gruntfile: {
                files: '<%= eslint.gruntfile.src %>',
                tasks: ['eslint:gruntfile']
            },
            js: {
                files: '<%= eslint.js.src %>',
                tasks: ['eslint:js'],
                options: {
                    spawn: false
                }
            }
        }
    });


    // Lint with the ESLint Node API. grunt-eslint is not used: it depends on ESLint 9,
    // which would pull a second ESLint version into node_modules.
    grunt.registerMultiTask('eslint', 'Validate files with ESLint', function ()
    {
        const done = this.async(),
            files = this.filesSrc;

        if (files.length === 0) {
            grunt.log.writeln('No files to lint.');
            done();
            return;
        }

        const {ESLint} = require('eslint');

        (async function ()
        {
            const eslint = new ESLint(),
                results = await eslint.lintFiles(files),
                formatter = await eslint.loadFormatter('stylish'),
                output = await formatter.format(results);

            if (output) {
                grunt.log.writeln(output);
            }

            done(ESLint.getErrorResults(results).length === 0);
        })().catch(function (error) {
            grunt.fail.warn(error);
        });
    });


    // == Tasks ==
    grunt.registerTask('default', ['jsonlint', 'eslint', 'htmllint', 'uglify', 'notify:done']);
    grunt.registerTask('min',   ['uglify', 'notify:done']);
};
