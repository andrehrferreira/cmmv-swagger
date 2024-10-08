const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const semver = require('semver');
const { spawn } = require('child_process');
const { cwd } = require('process');
const enquirer = require('enquirer');

const { prompt } = enquirer;
const currentVersion = JSON.parse(fs.readFileSync(path.resolve(cwd(), 'package.json'), "utf-8")).version;
const versionIncrements = ['patch', 'minor', 'major'];

const inc = (i) => semver.inc(currentVersion, i);
const run = (bin, args, opts = {}) => {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: 'inherit', ...opts });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`${bin} ${args.join(' ')} failed with code ${code}`));
                return;
            }
            resolve();
        });
    });
};

const step = (msg) => console.log(chalk.cyan(msg));

async function main() {
    let targetVersion;

    const { release } = await prompt({
        type: 'select',
        name: 'release',
        message: 'Select release type',
        choices: versionIncrements.map((i) => `${i} (${inc(i)})`).concat(['custom'])
    });

    if (release === 'custom') {
        targetVersion = (
            await prompt({
                type: 'input',
                name: 'version',
                message: 'Input custom version',
                initial: currentVersion
            })
        ).version;
    } else {
        targetVersion = release.match(/\((.*)\)/)[1];
    }

    if (!semver.valid(targetVersion)) {
        throw new Error(`Invalid target version: ${targetVersion}`);
    }

    const { yes: tagOk } = await prompt({
        type: 'confirm',
        name: 'yes',
        message: `Releasing v${targetVersion}. Confirm?`
    });

    if (!tagOk) {
        return;
    }

    // Update the package version.
    step('\nUpdating the package version...');
    updatePackage(targetVersion);

    // Build the package.
    step('\nBuilding the package...');
    await run('yarn', ['build']);

    // Generate the changelog.
    step('\nGenerating the changelog...');
    await run('yarn', ['changelog']);
    await run('yarn', ['prettier', '--write', 'CHANGELOG.md']);

    const { yes: changelogOk } = await prompt({
        type: 'confirm',
        name: 'yes',
        message: `Changelog generated. Does it look good?`
    });

    if (!changelogOk) {
        return;
    }

    // Commit changes to Git and create a tag.
    step('\nCommitting changes...');
    await run('git', ['add', 'CHANGELOG.md', 'package.json']);
    await run('git', ['commit', '-m', `release: v${targetVersion}`]);
    await run('git', ['tag', `v${targetVersion}`]);

    // Publish the package.
    step('\nPublishing the package...');
    await run('yarn', [
        'publish',
        '--new-version',
        targetVersion,
        '--no-commit-hooks',
        '--no-git-tag-version',
        '--access',
        'public'
    ]);

    // Push to GitHub.
    step('\nPushing to GitHub...');
    await run('git', ['push', 'origin', `refs/tags/v${targetVersion}`]);
    await run('git', ['push']);
}

function updatePackage(version) {
    const pkgPath = path.resolve(cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    pkg.version = version;

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
}

main().catch((err) => console.error(err));
