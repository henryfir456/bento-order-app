import packageJson from '../../package.json';
import changelogMarkdown from '../../CHANGELOG.md?raw';
import { parseChangelog } from './changelogParser';

export const APP_VERSION = packageJson.version;

export const CHANGELOG = parseChangelog(changelogMarkdown);
