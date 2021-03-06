const {Cache} = require("../Cache");
const {AcceptorClient} = require("../AcceptorClient");
const {Proposer} = require("../Proposer");
const {redisAsyncClient} = require("../utils/redisAsyncClient");

const fs = require("fs");
const readline = require("readline");

class Syncer {
    start(settings) {
        const cache = new Cache(settings.id);
        this.acceptors = settings.acceptors.map(x => new AcceptorClient(x));
        this.acceptors.forEach(x => x.start());

        this.proposer = new Proposer(cache, this.acceptors, settings.quorum);

        return this;
    }

    async sync(key) {
        return await this.proposer.changeQuery(key, state => [state, null],  x => x);
    }

    close() {
        this.acceptors.forEach(x => x.close());
    }
}

const settings = JSON.parse(fs.readFileSync(process.argv[2]));
console.info(settings);

var keys = fs.readFileSync(process.argv[3]).toString().split("\n").filter(x => x != "");

(async function() {
    var syncer = null;
    try {
        syncer = new Syncer().start(settings);
        for (const key of keys) {
            while (true) {
                const result = await syncer.sync(key);
                if (result.status=="OK") {
                    console.info("synced: " + key);
                    break;
                }
            } 
        }
        syncer.close();
        console.info("Done");
    } catch (error) {
        console.info(error);
        if (syncer != null) {
            syncer.close();
        }
    }
})();
