import {MultiPromise} from "./utils/MultiRequest";
import {log, msg} from "./utils/Logging";

const OK = typedRespondAbstractFactory("OK");
const NO = typedRespondAbstractFactory("NO");
const UNKNOWN = typedRespondAbstractFactory("UNKNOWN");

export default class Proposer {
    constructor(cache, acceptors, quorum, isLeaderless) {
        this.cache = cache;
        this.acceptors = acceptors;
        this.quorum = quorum;
        this.isLeaderless = isLeaderless;
    }

    async changeQuery(key, change, query, extra) {
        if (!this.cache.tryLock(key)) {
            return NO(log().append(msg("ERRNO002")).core);
        }
        let tick = null;
        if (this.isLeaderless || !this.cache.isLeader(key)) {
            tick = this.cache.tick(key).asJSON();
            const resp = MultiPromise.fromPromises(this.acceptors.map(x => x.prepare(key, tick, extra)));
            const successful = x => x.msg.isPrepared && !x.acceptor.shouldIgnore;
            const [ok, err] = await (resp.filter(successful).atLeast(this.quorum.read));
            if (err) {
                this.cache.unlock(key);
                return NO(err.append(msg("ERRNO008")).append(msg("ERRNO006")).append(msg("ERRNO003")).core);
            }
            this.cache.becomeLeader(key, max(ok, x => x.msg.tick).msg.state);
        } else {
            tick = this.cache.tick(key).asJSON();
        }
        const [state, err2] = change(this.cache.getState(key));
        const resp = MultiPromise.fromPromises(this.acceptors.map(x => x.accept(key, tick, state, extra)));
        
        const [ok, err3] = await (resp.filter(x => x.msg.isOk).atLeast(this.quorum.write));
        for (const x of resp.abort().filter(x => x.msg.isConflict)) {
            this.cache.fastforward(key, x.msg.tick);
            this.cache.lostLeadership(key);
        }
        
        this.cache.unlock(key);
        if (err3) {
            return UNKNOWN(err3.append(msg("ERRNO008")).append(msg("ERRNO004")).core);
        }
        
        this.cache.updateState(key, state);
        if (err2) return NO(err2.append(msg("ERRNO005")).core);
        return OK(query(state));
    }
}

function max(iterable, selector) {
    return iterable.reduce((acc,e) => {
        return selector(acc).compareTo(selector(e)) < 0 ? e : acc
    }, iterable[0]);
}

function typedRespondAbstractFactory(respondType) {
    return details => ({ "status": respondType, "details": details }); 
}