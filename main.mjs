import fetch from 'node-fetch';
import fs from 'fs';
import https from 'node:https';
import minimist from 'minimist';
import crypto from 'crypto';

import {globby} from 'globby';
import moment from 'moment';

import { parseArgsStringToArgv } from 'string-argv';
import { spawn } from 'cross-spawn';

import clc from 'cli-color';







class Discord {
    constructor(token, CACHE_FOLDER, hashedToken) {
        this.agent = new https.Agent({ keepAlive: true });
        this.token = token;
        this.CACHE_FOLDER = CACHE_FOLDER;
        this.hashedToken = hashedToken;
    }

    async saveToFile(fileName, json) {
        fs.writeFileSync(this.CACHE_FOLDER + fileName, JSON.stringify(json, null, 2));
    }


    async discordFetch(endpoint, fileName) {
        const folder = this.CACHE_FOLDER + fileName.split('/').slice(0, -1).join('/');
        fs.mkdirSync(folder, { recursive: true });
        if (fs.existsSync(this.CACHE_FOLDER + fileName)) {
            console.log("Using cache", `/api/v9/${endpoint}`);
            return JSON.parse(fs.readFileSync(this.CACHE_FOLDER + fileName));
        }
        console.log(`Requesting /v9/${endpoint}`);

        let agent = this.agent;
        let token = this.token;

        const response = await fetch(`https://discord.com/api/v9/${endpoint}`, {
            "credentials": "include",
            "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9",
                "authorization": token,
                "sec-ch-ua": "\"Chromium\";v=\"106\", \"Google Chrome\";v=\"106\", \"Not;A=Brand\";v=\"99\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "x-debug-options": "bugReporterEnabled",
                "x-discord-locale": "en-GB",
                "x-super-properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzEwNi4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiYnJvd3Nlcl92ZXJzaW9uIjoiMTA2LjAuMC4wIiwib3NfdmVyc2lvbiI6IjEwIiwicmVmZXJyZXIiOiJodHRwczovL3d3dy5nb29nbGUuY29tLyIsInJlZmVycmluZ19kb21haW4iOiJ3d3cuZ29vZ2xlLmNvbSIsInNlYXJjaF9lbmdpbmUiOiJnb29nbGUiLCJyZWZlcnJlcl9jdXJyZW50IjoiIiwicmVmZXJyaW5nX2RvbWFpbl9jdXJyZW50IjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6MTUzNjU1LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==",
                "Referer": "https://discord.com/",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            },
            "referrer": "https://discord.com/",
            "method": "GET",
            "mode": "cors",
            agent
        });

        const json = await response.json();

        if (response.status === 429) {
            console.log("Rate limited (429: Retry after", json.retry_after, "s)");
            await new Promise(r => setTimeout(r, (json.retry_after + 1) * 1156));
            return this.discordFetch(endpoint);
        }
        if (json.message) {
            console.error("Error:", json.message, json.code, endpoint);
            // panic mode - kill the app on api error
            process.exit(1);
        }


        // PARANOID MODE - random delay to avoid hitting rate limit and bot detection
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5745));

        // save to file
        this.saveToFile(fileName, json);

        return json;
    }

    async getChannels(guildId) {
        const fileName = `guilds/${guildId}/channels.json`
        const channels = await this.discordFetch(`guilds/${guildId}/channels`, fileName);
        return channels;
    }

    async getUserProfile() {
        const fileName = `users/${this.hashedToken}/me.json`
        const guild = await this.discordFetch(`users/@me`, fileName);
        return guild;
    }


    async getGuildUserProfile(userId, guildId) {
        const fileName = `users/${this.hashedToken}/guilds/${guildId}/me.json`;
        const profile = await this.discordFetch(`users/${userId}/profile?with_mutual_guilds=false&guild_id=${guildId}`, fileName);
        return profile;
    }


    async hasChannelViewPermission(channels, channelId, roles) {
        const channel = channels.find(c => c.id === channelId);

        if (channel.parent_id !== null) {
            const hasParentPermission = await this.hasChannelViewPermission(channels, channel.parent_id, roles);
            if (!hasParentPermission) {
                // console.log("No permission to view channel", channel.name, "because parent category is not visible");
                return false;
            }
        }

        let guildId = channel.guild_id;
        const VIEW_CHANNEL = 1024

        let hasPermission = true;
        let guildOverwrite = channel.permission_overwrites.find(overwrite => overwrite.id === guildId);
        if (guildOverwrite) {
            if (parseInt(guildOverwrite.deny) & VIEW_CHANNEL) {
                // console.log("Guild overwrite denies view channel", channel.name, guildOverwrite);
                hasPermission = false;
            }
        }

        // role overwrites
        let roleOverwrites = channel.permission_overwrites.filter(overwrite => roles.includes(overwrite.id));
        for (let overwrite of roleOverwrites) {
            if (parseInt(overwrite.deny) & VIEW_CHANNEL) {
                // console.log("denied", channel.name, overwrite.id);
                hasPermission = false;
            }
        }
        for (let overwrite of roleOverwrites) {
            if (parseInt(overwrite.allow) & VIEW_CHANNEL) {
                // console.log("allowed", channel.name, overwrite.id);
                hasPermission = true;
                return hasPermission;
            }
        }
        return hasPermission;
    }

    async getAllowedChannels(guildId) {
        console.log("Getting channels for guild", guildId);
        let channels = await this.getChannels(guildId);
        let userProfile = await this.getUserProfile()
        let guildProfile = await this.getGuildUserProfile(userProfile.id, guildId);

        let memberRoles = guildProfile.guild_member.roles;

        // loop channels and check if the user has access to the channel
        let hasAccess = [];
        let noAccess = [];
        for (const channel of channels) {
            if (channel.parent_id !== null) {
                if (await this.hasChannelViewPermission(channels, channel.id, memberRoles)) {
                    hasAccess.push(channel);
                }
                else {
                    noAccess.push(channel);
                }
            }
        }
        // console.log("Has access", JSON.stringify(hasAccess.map(c => c.name), null, 2));
        // console.log("No access", JSON.stringify(noAccess.map(c => c.name), null, 2));
        return hasAccess;
    }

    async getThreads(guildId, channelId) {
        let offset=0;
        let allThreads = [];
        while(true) {
            const fileName = `guilds/${guildId}/threads/${channelId}_${offset}.json`;
            let threads = await this.discordFetch(`channels/${channelId}/threads/search?archived=true&sort_by=last_message_time&sort_order=desc&limit=25&offset=${offset}`, fileName);
            allThreads = allThreads.concat(threads.threads);
            if (!threads.has_more) {
                break;
            }
            offset += 25;
        }
        return allThreads;
    }
}


class DiscordExport {
    constructor(path) {
        this.path = path;
    }

    async findAllJsonFiles() {
        console.log("Finding all json files in", this.path);
        const files = await globby(`${this.path}/**/*.json`);
        return files;
    }


    async findLastMessageIds(guildId) {
        // read all json files
        const files = await this.findAllJsonFiles();
        console.log("Found", files.length, "files");
        const lastMessageIds = {};  // key is channel id, value is last message id
        console.log("Reading json files...");
        for (const file of files) {
            // console.log("Reading file", file);
            try {
                const json = JSON.parse(fs.readFileSync(file))
                const channelId = json.channel.id;
                for (const message of json.messages) {
                    if (!lastMessageIds[channelId] || BigInt(message.id) > BigInt(lastMessageIds[channelId]['id'])) {
                        lastMessageIds[channelId] = {
                            "id": message.id,
                            "timestamp": message.timestamp
                        };
                    }
                }
            }
            catch (e) {
                console.error("Invalid export file", file);
            }
        }
        return lastMessageIds;
    }
}







const args = minimist(process.argv.slice(2), {
    string: ['token', 'guild'],
    boolean: ['help', 'dryrun'],
    alias: {
        t: 'token',
        g: 'guild'
    }
});
console.log("args", args);
// process.exit(1);

if (args._.length === 0 || args.help) {
    console.error('## Discord export helper ##')
    console.log('Available commands:');
    console.log('  channels --token <token1> [--token <token2> ...] --guild <guildId> --output "<export_folder_path>"');
    console.log('  add --dryrun to only print the commands to be executed');
    console.log('  add --checkall to check all channels for updated threads, not just the ones with new messages');
    process.exit(1);
}

// check if token is provided
if (!args.token) {
    console.error('No token provided, use --token "<token>"');
    process.exit(1);
}






function execCommand(command) {
    // command = 'ping 1.1.1.1'   // DEBUG

    if (!args.dryrun) {
        console.log(command);
        // console.log('NOT DRY RUN');
        let args = parseArgsStringToArgv(command);
        let cmd = args.shift();
        var child = spawn.sync(cmd, args, { stdio: 'inherit' });
        if(child.error) {
            console.log("ERROR: ",child.error);
            // process.exit(1);
        }
    }
    else {
        console.log(command);
    }

}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 10)
}

async function downloadChannelOrThread(channel, ignoreChannelIds, lastMessageIds, token, OUTPUT_FOLDER, discord) {
    let channelTypeDebug = clc.blue("channel")
    if (channel.type === 11) {
        channelTypeDebug = clc.magenta("thread")
    }
    if (ignoreChannelIds.includes(channel.id)) {
        console.log(`Ignoring ${channelTypeDebug} ${clc.yellow(channel.name)}, because it was already downloaded`);
        return ignoreChannelIds
    }
    if (channel.last_message_id === null) {
        console.log(`No messages in ${channelTypeDebug} ${clc.yellow(channel.name)}`);
        return ignoreChannelIds
    }
    else if (!lastMessageIds[channel.id]) {
        console.log(`${clc.green('New')} ${channelTypeDebug} ${clc.yellow(channel.name)} with messages`, );
        // TODO: FIX POSSIBLE COMMAND INJECTION
        execCommand(`DiscordChatExporter.Cli export --token ${token} --format Json --media --reuse-media --channel ${channel.id} --output ${OUTPUT_FOLDER}`);
        ignoreChannelIds.push(channel.id);
    }
    else if (lastMessageIds[channel.id]['id'] === channel.last_message_id) {
        console.log(`${channelTypeDebug} ${clc.yellow(channel.name)} is already up to date`);
        if (!args.checkall) {  // check all channels for updated threads, not just the ones with new messages?
            return ignoreChannelIds
        }
    }
    else {
        console.log(`${clc.green('More messages')} found in ${channelTypeDebug} ${clc.yellow(channel.name)}`);  // sometimes is false positive if the last message was deleted
        // TODO: FIX POSSIBLE COMMAND INJECTION
        execCommand(`DiscordChatExporter.Cli export --token ${token} --format Json --media --reuse-media --channel ${channel.id} --after ${moment(lastMessageIds[channel.id]['timestamp']).utcOffset(0).add(1, 'seconds').format()} --output ${OUTPUT_FOLDER}`);
        ignoreChannelIds.push(channel.id);
    }
    if (channel.type === 0 || channel.type === 15) {  // 0=threads, 15=forums
        // download threads/forums
        const threads = await discord.getThreads(args.guild, channel.id);
        for (const thread of threads) {
            ignoreChannelIds = await downloadChannelOrThread(thread, ignoreChannelIds, lastMessageIds, token, OUTPUT_FOLDER + '_threads/', discord);
        }
    }
    return ignoreChannelIds
}

async function exportChannels(token, ignoreChannelIds, lastMessageIds) {
    // hash token to get a unique folder for each user
    const hashedToken = hashToken(token)
    const dateString = new Date().toISOString().slice(0, 10);  //yyyy_mm_dd
    // const dateString = new Date().toISOString().slice(0, 19).replace(/:/g, '-');  // yyyy_mm_dd_hh_mm_ss
    const CACHE_FOLDER = `cache/${dateString}/`;


    // if OUTPUT_FOLDER does not exist, create it
    // if (fs.existsSync(OUTPUT_FOLDER)) {
    //     console.log("Today's backup was already done for this token, aborting");
    //     return ignoreChannelIds
    // }
    const discord = new Discord(token, CACHE_FOLDER, hashedToken);



    const allowedChannels = await discord.getAllowedChannels(args.guild);
    const userName = (await discord.getUserProfile()).username;
    const safeUserName = userName.replace(/[^a-zA-Z0-9]/gi, '')

    const OUTPUT_FOLDER = args.output.replace(/\\/g, "/") + "/automated/" + args.guild + "/" + safeUserName + "/" + dateString + "/";

    console.log(`Logged in as ${clc.green(userName)}`);
    // const commands = []
    for (const channel of allowedChannels) {
        ignoreChannelIds = await downloadChannelOrThread(channel, ignoreChannelIds, lastMessageIds, token, OUTPUT_FOLDER, discord)
    }
    return ignoreChannelIds;
}

if (args._.includes('channels')) {
    if (!args.guild) {
        console.error('No guild provided, use --guild "<guildId>"');
    }
    if (!args.output) {
        console.error('No exports folder provided, use --output "<export_folder_path>"');
    }
    else {
        // if args.token is not an array, make it one
        if (!Array.isArray(args.token)) {
            args.token = [args.token];
        }

        const INPUT_FOLDER = args.output.replace(/\\/g, "/");
        const discordExport = new DiscordExport(INPUT_FOLDER);
        const lastMessageIds = await discordExport.findLastMessageIds()

        let ignoreChannelIds = [];
        for (const token of args.token) {
            console.log("\n\n\n\n\n");
            ignoreChannelIds = await exportChannels(token, ignoreChannelIds, lastMessageIds);
        }
    }
}
else {
    console.error('Unknown command:', args._[0]);
}