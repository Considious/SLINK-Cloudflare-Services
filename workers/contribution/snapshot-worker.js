import {snapshotFairFightBackup} from './fair-fight-backup.js';
export default {scheduled(controller,env,ctx){ctx.waitUntil(snapshotFairFightBackup(env,controller.scheduledTime));}};
