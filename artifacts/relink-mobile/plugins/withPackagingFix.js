/**
 * Custom Expo config plugin to fix duplicate META-INF resource conflict
 * between okhttp3:logging-interceptor and org.jspecify:jspecify.
 * Uses the new AGP `packaging.resources.excludes` API.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const withPackagingFix = (config) => {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;

    const packagingBlock = `
    packaging {
        resources {
            excludes += ['META-INF/versions/9/OSGI-INF/MANIFEST.MF']
        }
    }`;

    // Only add if not already present
    if (!buildGradle.includes('META-INF/versions/9/OSGI-INF/MANIFEST.MF')) {
      // Insert inside the android { ... } block
      config.modResults.contents = buildGradle.replace(
        /android\s*\{/,
        `android {${packagingBlock}`
      );
    }

    return config;
  });
};

module.exports = withPackagingFix;
