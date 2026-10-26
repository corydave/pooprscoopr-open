// =====================================================================
// PooprScoopr online: SAVE CODES and the LEADERBOARD
// =====================================================================
// This file runs on Cloudflare's servers (a "Pages Function"), NOT in the
// player's browser. Because it sits in the folder functions/api/ and is
// named [[path]].js, Cloudflare sends every request for /api/<anything>
// on the game's own website here. Same website = no CORS headaches.
//
// What it does:
//   POST /api/save    Save a career to the cloud. With no code, it makes a
//                     new save code (like "muddy-otter-pickle") and sends
//                     it back. With a code, it updates that save. It can
//                     also update the player's leaderboard entry.
//   POST /api/load    Send back the career saved under a code.
//   GET  /api/scores  The top of the leaderboard.
//   POST /api/leave   Take a player's entry off the leaderboard.
//
// Setup (once, in the Cloudflare dashboard - see ONLINE-SETUP.md):
//   1. Create a D1 database and run schema.sql in its console.
//   2. In the Pages project: Settings > Bindings > add the D1 database
//      with the variable name DB.
//   3. Optional but recommended: Settings > Variables and Secrets > add a
//      secret named SECRET_SALT holding any long random text. Set it once
//      and never change it (changing it makes every save code stop working).
//
// SECURITY AND PRIVACY - read this before changing anything:
//   - Never trust what the browser sends. Every field is checked here.
//   - Every SQL statement uses "?" placeholders with .bind(...), never
//     text glued into the SQL, so nobody can inject their own SQL.
//   - Save codes are stored only as a scrambled fingerprint (a SHA-256
//     hash), so even someone who saw the database could not read the codes.
//   - IP addresses are never stored. For rate limiting we keep a hash of
//     the address mixed with the secret salt and today's date, which cannot
//     be turned back into an address and changes every day.
//   - No names, emails or accounts: just 3 initials, progress, cash
//     earned, difficulty and badge IDs. Kids play this game.
//   - Only the game's own website may call this (see sameSiteOnly).
// =====================================================================

// ---------------------------------------------------------------------
// LIMITS - change these numbers to tune things.
// ---------------------------------------------------------------------
const MAX_BODY_BYTES = 20000;       // a career save is a few KB; refuse anything huge
const BOARD_SIZE = 25;              // how many entries GET /api/scores returns
const REQUESTS_PER_MINUTE = 40;     // per player (per hashed IP), all routes together
const BAD_CODES_PER_HOUR = 20;      // wrong save codes allowed per hour, so codes cannot be guessed
const MAX_BADGES = 120;             // more badge IDs than the game has is junk
const LAST_PARK = 4;                // parks are numbered 0-4 in the game
const DAYS_PER_PARK = 4;
const CHAMPION = (LAST_PARK + 1) * DAYS_PER_PARK;   // 20 = every day of every park won
const DIFFICULTIES = ['easy', 'normal', 'nightmare'];

// ---------------------------------------------------------------------
// INITIALS BLOCKLIST - Dave, please vet and extend this list.
// ---------------------------------------------------------------------
// Three-letter initials that may not go on the board. Checked here on the
// server (the only check that counts - a browser can be made to skip its
// own checks). Uppercase only.
const BLOCKED_INITIALS = new Set([
  'ASS', 'FUK', 'FUC', 'FCK', 'FKU', 'FUX', 'SHT', 'CUM', 'COK', 'COC', 'DIK', 'DIC', 'KKK',
  'NIG', 'NGR', 'FAG', 'FGT', 'HOE', 'WTF', 'STF', 'GFY', 'SEX', 'TIT', 'VAG', 'PIS', 'PNS',
  'NAZ', 'JIZ', 'POS', 'SOB', 'KYS', 'DMN', 'XXX', 'ANL', 'BJS', 'BUM', 'CNT', 'KUM', 'SUK'
]);

// ---------------------------------------------------------------------
// SAVE-CODE WORDS: adjective - animal - thing, e.g. "muddy-otter-pickle".
// ---------------------------------------------------------------------
// About 275 x 275 x 280 = over 21 million possible codes. Combined with
// the wrong-code limit above, guessing someone else's code is hopeless.
// Every word is family friendly; please keep it that way if you add any.
const ADJECTIVES = [
    'muddy', 'fuzzy', 'sneaky', 'sparkly', 'bouncy', 'brave', 'breezy', 'bubbly', 'chilly', 'cozy', 'crispy',
    'curly', 'dizzy', 'dusty', 'fancy', 'fluffy', 'frosty', 'giggly', 'glowing', 'golden', 'goofy', 'grumpy',
    'happy', 'hasty', 'jolly', 'jumpy', 'lucky', 'mellow', 'minty', 'misty', 'nifty', 'peppy', 'perky', 'plucky',
    'polite', 'proud', 'quick', 'quiet', 'quirky', 'rusty', 'salty', 'sandy', 'shiny', 'silly', 'sleepy', 'snappy',
    'snowy', 'soggy', 'speedy', 'spicy', 'sturdy', 'sunny', 'swift', 'tidy', 'tiny', 'toasty', 'wiggly', 'windy',
    'witty', 'zesty', 'zippy', 'agile', 'amber', 'awesome', 'bashful', 'beefy', 'blazing', 'bold', 'bright',
    'brisk', 'bumpy', 'busy', 'calm', 'candid', 'caring', 'cheery', 'chirpy', 'clever', 'cloudy', 'clumsy',
    'crafty', 'cranky', 'crunchy', 'cuddly', 'daring', 'dapper', 'dazzling', 'dreamy', 'eager', 'early', 'epic',
    'fearless', 'feisty', 'fiery', 'fizzy', 'flashy', 'fleet', 'floppy', 'friendly', 'frisky', 'funky', 'gentle',
    'giant', 'gleeful', 'glossy', 'grand', 'grassy', 'groovy', 'gusty', 'handy', 'hardy', 'hearty', 'helpful',
    'hopeful', 'humble', 'icy', 'jazzy', 'jiggly', 'joyful', 'juicy', 'keen', 'kind', 'kooky', 'leafy', 'lively',
    'lovely', 'loyal', 'marvelous', 'merry', 'mighty', 'mini', 'modest', 'mossy', 'nimble', 'noble', 'nutty',
    'orange', 'peachy', 'pebbly', 'perfect', 'pink', 'polished', 'prickly', 'puffy', 'purple', 'quacky', 'radiant',
    'rapid', 'ready', 'rosy', 'round', 'royal', 'rumbly', 'secret', 'shaggy', 'sharp', 'sly', 'smiley', 'smooth',
    'snazzy', 'snoozy', 'soft', 'sparky', 'spiffy', 'splashy', 'spotty', 'spunky', 'squeaky', 'squishy', 'steady',
    'stormy', 'stripy', 'sugary', 'super', 'swirly', 'tangy', 'tasty', 'thrifty', 'thundering', 'ticklish',
    'tough', 'trusty', 'twinkly', 'upbeat', 'valiant', 'velvet', 'vivid', 'wacky', 'warm', 'wavy', 'wild', 'wise',
    'wobbly', 'woolly', 'zany', 'zealous', 'zigzag', 'acrobatic', 'bendy', 'blissful', 'bouncing', 'brilliant',
    'buttery', 'chatty', 'chipper', 'chummy', 'cinnamon', 'cobalt', 'comfy', 'cosmic', 'crimson', 'crystal',
    'curious', 'dainty', 'dashing', 'elated', 'emerald', 'fabulous', 'fluttery', 'foamy', 'freckled', 'frothy',
    'galactic', 'gallant', 'glittery', 'gooey', 'graceful', 'gummy', 'hazel', 'hoppy', 'humming', 'indigo',
    'lemony', 'lilac', 'lucid', 'magic', 'maple', 'marshy', 'neon', 'nippy', 'ochre', 'olive', 'patient', 'plaid',
    'puzzled', 'quaint', 'rambling', 'rattly', 'rippling', 'rocky', 'rolling', 'rustic', 'saffron', 'scarlet',
    'sincere', 'skippy', 'slinky', 'snuggly', 'sprightly', 'starry', 'steamy', 'stellar', 'sudsy', 'swanky',
    'teal', 'tinsel', 'toffee', 'tropical', 'turbo', 'twirly', 'vanilla', 'whimsical', 'whistling', 'wonky',
    'yodeling'
];
const ANIMALS = [
    'otter', 'badger', 'beagle', 'bison', 'camel', 'capybara', 'cheetah', 'chipmunk', 'cougar', 'coyote', 'crab',
    'crane', 'cricket', 'dingo', 'dolphin', 'donkey', 'duck', 'eagle', 'ferret', 'finch', 'flamingo', 'fox',
    'frog', 'gecko', 'gerbil', 'gibbon', 'giraffe', 'goat', 'goose', 'gopher', 'gorilla', 'hamster', 'hedgehog',
    'heron', 'hippo', 'husky', 'ibis', 'iguana', 'jackal', 'jaguar', 'kangaroo', 'koala', 'lemur', 'leopard',
    'lizard', 'llama', 'lobster', 'lynx', 'macaw', 'magpie', 'manatee', 'marmot', 'meerkat', 'mole', 'moose',
    'mouse', 'narwhal', 'newt', 'ocelot', 'octopus', 'opossum', 'orca', 'ostrich', 'owl', 'panda', 'parrot',
    'pelican', 'penguin', 'pigeon', 'platypus', 'poodle', 'porcupine', 'puffin', 'puma', 'quail', 'rabbit',
    'raccoon', 'raven', 'robin', 'salamander', 'salmon', 'seal', 'shark', 'sheep', 'skunk', 'sloth', 'snail',
    'sparrow', 'squid', 'squirrel', 'starfish', 'stork', 'swan', 'tapir', 'tiger', 'toad', 'toucan', 'turtle',
    'walrus', 'weasel', 'whale', 'wombat', 'yak', 'zebra', 'alpaca', 'anteater', 'armadillo', 'axolotl', 'baboon',
    'bat', 'bear', 'beetle', 'bluejay', 'bobcat', 'buffalo', 'bulldog', 'butterfly', 'canary', 'caribou',
    'catfish', 'chameleon', 'chicken', 'chihuahua', 'chinchilla', 'condor', 'corgi', 'cow', 'crow', 'dachshund',
    'deer', 'dodo', 'dragonfly', 'eel', 'elephant', 'elk', 'emu', 'falcon', 'firefly', 'gazelle', 'gnu',
    'goldfish', 'grouse', 'guppy', 'hare', 'hawk', 'hummingbird', 'hyena', 'impala', 'jellyfish', 'kingfisher',
    'kitten', 'kiwi', 'ladybug', 'lark', 'lion', 'mackerel', 'mallard', 'mammoth', 'mantis', 'marten', 'minnow',
    'mongoose', 'monkey', 'moth', 'mule', 'mussel', 'orangutan', 'oriole', 'oyster', 'panther', 'parakeet',
    'pheasant', 'piglet', 'pike', 'pony', 'prawn', 'pug', 'python', 'rhino', 'rooster', 'sardine', 'seagull',
    'shrimp', 'snapper', 'spaniel', 'stingray', 'sturgeon', 'swordfish', 'tadpole', 'terrier', 'tortoise', 'trout',
    'tuna', 'turkey', 'vulture', 'wallaby', 'warthog', 'wolf', 'wren', 'yeti', 'unicorn', 'dragon', 'griffin',
    'kraken', 'phoenix', 'sasquatch', 'aardvark', 'albatross', 'antelope', 'beaver', 'bumblebee', 'chickadee',
    'clam', 'coral', 'cuttlefish', 'dove', 'egret', 'flounder', 'goblin', 'grasshopper', 'herring', 'hornbill',
    'jay', 'kestrel', 'koi', 'lamb', 'limpet', 'loon', 'lovebird', 'marlin', 'mink', 'mockingbird', 'moray',
    'muskrat', 'nuthatch', 'okapi', 'osprey', 'pangolin', 'parrotfish', 'partridge', 'periwinkle', 'petrel',
    'pika', 'piranha', 'plover', 'quetzal', 'reindeer', 'roadrunner', 'sandpiper', 'scallop', 'seahorse', 'serval',
    'shrew', 'skylark', 'slug', 'songbird', 'spoonbill', 'starling', 'tamarin', 'tarsier', 'tern', 'thrush',
    'toadlet', 'tuatara', 'turtledove', 'urchin', 'vole', 'wagtail', 'warbler', 'waterbuffalo', 'whippet',
    'wildcat', 'wolverine', 'woodchuck', 'yellowtail', 'zebu'
];
const THINGS = [
    'pickle', 'waffle', 'kazoo', 'pancake', 'muffin', 'noodle', 'pretzel', 'biscuit', 'button', 'cactus', 'candle',
    'carrot', 'cookie', 'crayon', 'cupcake', 'donut', 'garden', 'gumdrop', 'hammock', 'helmet', 'jellybean',
    'jigsaw', 'kettle', 'kite', 'ladder', 'lantern', 'lemon', 'mango', 'marble', 'meadow', 'mitten', 'nugget',
    'oatmeal', 'paddle', 'pebble', 'pillow', 'pinecone', 'popcorn', 'potato', 'puddle', 'pumpkin', 'puzzle',
    'rainbow', 'ribbon', 'rocket', 'saddle', 'sandwich', 'scooter', 'shovel', 'sock', 'spoon', 'sprinkle',
    'sundae', 'taco', 'teapot', 'tractor', 'trumpet', 'tulip', 'turnip', 'umbrella', 'violin', 'wagon', 'walnut',
    'whistle', 'yoyo', 'zipper', 'acorn', 'anchor', 'apple', 'apricot', 'bagel', 'balloon', 'banjo', 'basket',
    'beacon', 'blanket', 'blueberry', 'bonnet', 'boot', 'bucket', 'bubble', 'burrito', 'cabbage', 'canoe',
    'caramel', 'castle', 'cherry', 'chimney', 'cobbler', 'comet', 'compass', 'cracker', 'crumpet', 'cushion',
    'daisy', 'dumpling', 'falafel', 'feather', 'fiddle', 'fig', 'flute', 'fudge', 'galaxy', 'gazebo', 'ginger',
    'glacier', 'goblet', 'gravy', 'guitar', 'harmonica', 'hatbox', 'honey', 'iceberg', 'igloo', 'jamboree',
    'jelly', 'kayak', 'lasagna', 'lollipop', 'macaroni', 'magnet', 'map', 'meatball', 'melon', 'meteor', 'mocha',
    'moon', 'mushroom', 'nacho', 'nectar', 'nutmeg', 'oboe', 'omelet', 'orchard', 'paintbrush', 'papaya',
    'parsnip', 'pasta', 'peanut', 'pearl', 'pie', 'pinwheel', 'pizza', 'planet', 'plum', 'pogo', 'pudding',
    'quilt', 'radish', 'raisin', 'ravioli', 'robot', 'rutabaga', 'salad', 'scone', 'sled', 'snowball', 'snowcone',
    'sombrero', 'soup', 'sprocket', 'squash', 'stew', 'sticker', 'strudel', 'sunflower', 'sushi', 'teacup',
    'thimble', 'toaster', 'toffee', 'tomato', 'trombone', 'tuba', 'tugboat', 'ukulele', 'volcano', 'watermelon',
    'windmill', 'xylophone', 'yogurt', 'zucchini', 'accordion', 'airship', 'almond', 'backpack', 'bandana',
    'barrel', 'beanbag', 'bicycle', 'blimp', 'bookmark', 'boomerang', 'bowtie', 'bracelet', 'broccoli', 'brownie',
    'buggy', 'bugle', 'cannoli', 'carousel', 'cashew', 'catapult', 'cauliflower', 'cereal', 'chestnut', 'churro',
    'clarinet', 'clover', 'coconut', 'cupboard', 'custard', 'dandelion', 'doorbell', 'drum', 'easel', 'eggplant',
    'envelope', 'fountain', 'frisbee', 'gadget', 'gingerbread', 'glove', 'gondola', 'granola', 'hairbrush',
    'headband', 'hotdog', 'jukebox', 'keyboard', 'keychain', 'kiwifruit', 'lamppost', 'lemonade', 'locket',
    'mailbox', 'marshmallow', 'mixtape', 'necktie', 'nutcracker', 'oatcake', 'octagon', 'ornament', 'pajamas',
    'parachute', 'peach', 'pennant', 'piano', 'pinata', 'pitchfork', 'popsicle', 'postcard', 'pumpernickel',
    'radio', 'rattle', 'sailboat', 'satchel', 'seashell', 'skateboard', 'slipper', 'snorkel', 'spatula', 'sprout',
    'stapler', 'sweater', 'tambourine', 'telescope', 'tinsel', 'toboggan', 'trampoline', 'treehouse', 'trolley',
    'tricycle', 'tutu', 'typewriter', 'unicycle', 'valentine', 'wafer', 'wheelbarrow', 'yarn'
];

// Quick lookup sets, so checking a typed code is fast.
const ADJ_SET = new Set(ADJECTIVES);
const ANIMAL_SET = new Set(ANIMALS);
const THING_SET = new Set(THINGS);

// =====================================================================
// THE ENTRY POINT: Cloudflare calls this for every /api/... request.
// =====================================================================
export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (!env.DB) return reply(500, { error: 'The database is not connected yet (no DB binding).' });

    // Which route? params.path is the part after /api/, split on "/".
    const route = (context.params.path || []).join('/');

    if (!sameSiteOnly(request)) return reply(403, { error: 'Only the game itself can do that.' });
    if (await rateLimited(env, request, 'any', REQUESTS_PER_MINUTE, 60)) {
      return reply(429, { error: 'Whoa, slow down! Try again in a minute.' });
    }

    if (route === 'scores' && request.method === 'GET') return await getScores(env);
    if (request.method !== 'POST') return reply(405, { error: 'Not allowed.' });

    // Every POST carries a small JSON body.
    const body = await readJson(request);
    if (!body) return reply(400, { error: 'That did not look like game data.' });

    if (route === 'save') return await saveCareer(env, request, body);
    if (route === 'load') return await loadCareer(env, request, body);
    if (route === 'leave') return await leaveBoard(env, request, body);
    return reply(404, { error: 'No such thing here.' });
  } catch (err) {
    // Never show the player (or an attacker) the inner workings.
    console.log('PooprScoopr API error:', err && err.stack ? err.stack : err);
    return reply(500, { error: 'Something went wrong on our end. Please try again later.' });
  }
}

// ---------------------------------------------------------------------
// POST /api/save  { code?, save, entry? }  ->  { code, board }
// ---------------------------------------------------------------------
async function saveCareer(env, request, body) {
  const save = checkSave(body.save);
  if (!save) return reply(400, { error: 'That career save does not look right.' });
  const saveJson = JSON.stringify(save);
  const now = Date.now();

  // An existing code updates its save; no code makes a brand-new one.
  let code = body.code ? normalizeCode(body.code) : null;
  let codeHash;
  if (code) {
    if (!isValidCode(code)) return reply(400, { error: 'That save code is not a real one.' });
    codeHash = await sha256(code + '|' + (env.SECRET_SALT || ''));
    const result = await env.DB.prepare('UPDATE saves SET save_json = ?, updated_at = ? WHERE code_hash = ?')
      .bind(saveJson, now, codeHash).run();
    if (!result.meta || result.meta.changes === 0) {
      if (await rateLimited(env, request, 'badcode', BAD_CODES_PER_HOUR, 3600)) {
        return reply(429, { error: 'Too many wrong codes. Try again in an hour.' });
      }
      return reply(404, { error: 'No save was found for that code.' });
    }
  } else {
    // Pick a random code nobody has yet (a clash is very unlikely; retry a few times).
    for (let attempt = 0; attempt < 6 && !codeHash; attempt++) {
      const candidate = makeCode();
      const hash = await sha256(candidate + '|' + (env.SECRET_SALT || ''));
      const result = await env.DB.prepare(
        'INSERT OR IGNORE INTO saves (code_hash, save_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(hash, saveJson, now, now).run();
      if (result.meta && result.meta.changes === 1) { code = candidate; codeHash = hash; }
    }
    if (!codeHash) return reply(500, { error: 'Could not make a save code. Please try again.' });
  }

  // Leaderboard entry, if the player has joined and sent one.
  let board = 'not sent';
  if (body.entry) board = await updateBoard(env, codeHash, save, body.entry, now);
  return reply(200, { code, board });
}

// ---------------------------------------------------------------------
// The leaderboard entry for one save code. The score comes from the SAVE
// (how far the career has got, and the cash it has earned), not from
// numbers the browser sends separately.
// ---------------------------------------------------------------------
async function updateBoard(env, codeHash, save, entry, now) {
  const initials = String(entry.initials || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(initials)) return 'refused: initials must be 3 letters';
  if (BLOCKED_INITIALS.has(initials)) return 'refused: please pick different initials';
  if (save.charlieUsed) return 'refused: this career used Charlie mode';
  const difficulty = DIFFICULTIES.includes(entry.difficulty) ? entry.difficulty : 'normal';
  const badges = checkBadges(entry.badges);

  const progress = save.parkIndex * DAYS_PER_PARK + save.consecutiveWins;   // days won so far, 0-20
  const earned = save.careerEarned;

  const old = await env.DB.prepare('SELECT progress, earned FROM scores WHERE code_hash = ?')
    .bind(codeHash).first();
  if (!old) {
    await env.DB.prepare(
      'INSERT INTO scores (code_hash, initials, progress, earned, difficulty, badges, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(codeHash, initials, progress, earned, difficulty, JSON.stringify(badges), now).run();
    return 'posted';
  }
  // Days are won one at a time, so a jump of more than one day since the
  // last post is not believable. (A new career that starts lower is fine:
  // the board keeps each code's BEST career.)
  if (progress > old.progress + 1) return 'refused: too big a jump since your last post';
  let bestProgress = old.progress, bestEarned = old.earned;
  if (progress > old.progress) { bestProgress = progress; bestEarned = earned; }
  else if (progress === old.progress) bestEarned = Math.max(old.earned, earned);
  await env.DB.prepare(
    'UPDATE scores SET initials = ?, progress = ?, earned = ?, difficulty = ?, badges = ?, updated_at = ? WHERE code_hash = ?')
    .bind(initials, bestProgress, bestEarned, difficulty, JSON.stringify(badges), now, codeHash).run();
  return 'posted';
}

// ---------------------------------------------------------------------
// POST /api/load  { code }  ->  { save }
// ---------------------------------------------------------------------
async function loadCareer(env, request, body) {
  const code = normalizeCode(body.code);
  // Wrong codes count against the hourly limit, valid-looking or not.
  if (!isValidCode(code)) return await wrongCode(env, request);
  const codeHash = await sha256(code + '|' + (env.SECRET_SALT || ''));
  const row = await env.DB.prepare('SELECT save_json FROM saves WHERE code_hash = ?').bind(codeHash).first();
  if (!row) return await wrongCode(env, request);
  const joined = await env.DB.prepare('SELECT initials FROM scores WHERE code_hash = ?').bind(codeHash).first();
  return reply(200, { code, save: JSON.parse(row.save_json), initials: joined ? joined.initials : null });
}

async function wrongCode(env, request) {
  if (await rateLimited(env, request, 'badcode', BAD_CODES_PER_HOUR, 3600)) {
    return reply(429, { error: 'Too many wrong codes. Try again in an hour.' });
  }
  return reply(404, { error: 'No save was found for that code. Check the spelling?' });
}

// ---------------------------------------------------------------------
// POST /api/leave  { code }  ->  { ok }
// ---------------------------------------------------------------------
async function leaveBoard(env, request, body) {
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) return await wrongCode(env, request);
  const codeHash = await sha256(code + '|' + (env.SECRET_SALT || ''));
  await env.DB.prepare('DELETE FROM scores WHERE code_hash = ?').bind(codeHash).run();
  return reply(200, { ok: true });
}

// ---------------------------------------------------------------------
// GET /api/scores  ->  { scores: [...] }
// ---------------------------------------------------------------------
// Ranked by how far the career got, then by cash earned, then by who got
// there first. "hidden" lets Dave take an entry down from the D1 console:
//   UPDATE scores SET hidden = 1 WHERE initials = 'XYZ';
async function getScores(env) {
  const { results } = await env.DB.prepare(
    'SELECT initials, progress, earned, difficulty, badges, updated_at FROM scores ' +
    'WHERE hidden = 0 ORDER BY progress DESC, earned DESC, updated_at ASC LIMIT ?')
    .bind(BOARD_SIZE).all();
  const scores = (results || []).map(r => ({
    initials: r.initials,
    progress: r.progress,
    champion: r.progress >= CHAMPION,
    earned: r.earned,
    difficulty: r.difficulty,
    badges: safeParseArray(r.badges),
    date: new Date(r.updated_at).toISOString().slice(0, 10)    // the day only
  }));
  return reply(200, { scores });
}

// =====================================================================
// CHECKING WHAT THE BROWSER SENT
// =====================================================================

// A career save must look like one of the game's own. We check the
// fields the leaderboard depends on, and the overall size.
function checkSave(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  const parkIndex = save.parkIndex, wins = save.consecutiveWins;
  if (!Number.isInteger(parkIndex) || parkIndex < 0 || parkIndex > LAST_PARK) return null;
  if (!Number.isInteger(wins) || wins < 0 || wins > DAYS_PER_PARK) return null;
  const earned = Number(save.careerEarned || 0);
  if (!Number.isFinite(earned) || earned < 0 || earned > 10000000) return null;
  save.careerEarned = Math.floor(earned);
  save.charlieUsed = save.charlieUsed === true;
  if (JSON.stringify(save).length > MAX_BODY_BYTES) return null;
  return save;
}

// Badge IDs look like "no_shit_sherlock": lowercase letters, digits, underscores.
function checkBadges(list) {
  if (!Array.isArray(list)) return [];
  const clean = [];
  for (const id of list) {
    if (typeof id === 'string' && /^[a-z0-9_]{1,40}$/.test(id) && !clean.includes(id)) clean.push(id);
    if (clean.length >= MAX_BADGES) break;
  }
  return clean;
}

// "  Muddy Otter Pickle " -> "muddy-otter-pickle"
function normalizeCode(code) {
  return String(code || '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
}

function isValidCode(code) {
  const parts = code.split('-');
  return parts.length === 3 && ADJ_SET.has(parts[0]) && ANIMAL_SET.has(parts[1]) && THING_SET.has(parts[2]);
}

// A random code. crypto.getRandomValues is the browser-grade random number
// source (Math.random is not good enough for anything secret).
function makeCode() {
  return [pick(ADJECTIVES), pick(ANIMALS), pick(THINGS)].join('-');
}
function pick(list) {
  // Throw away numbers from the uneven top end, so every word is equally likely.
  const limit = Math.floor(0x100000000 / list.length) * list.length;
  const n = new Uint32Array(1);
  do { crypto.getRandomValues(n); } while (n[0] >= limit);
  return list[n[0] % list.length];
}

// Only accept calls made by pages on this same website. Browsers add an
// Origin header to POSTs; if it names a different site, refuse.
function sameSiteOnly(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;              // e.g. a plain GET typed into the address bar
  return origin === new URL(request.url).origin;
}

// Read a small JSON body, or null if it is too big, the wrong type, or broken.
async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const data = JSON.parse(text);
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  } catch (e) { return null; }
}

// =====================================================================
// RATE LIMITING (without storing anyone's IP address)
// =====================================================================
// Counts requests per player per time window in the "hits" table. The
// key is a hash of (secret salt + today's date + IP address + kind), so it
// cannot be turned back into an address and is different every day.
// Returns true when the player is over the limit.
async function rateLimited(env, request, kind, limit, windowSeconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const day = new Date().toISOString().slice(0, 10);
  const bucket = (await sha256((env.SECRET_SALT || '') + '|' + day + '|' + ip)).slice(0, 32) +
                 ':' + kind + ':' + windowStart;
  // Add one to this window's count (creating the row if it is new).
  await env.DB.prepare(
    'INSERT INTO hits (bucket, n, expires) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET n = n + 1')
    .bind(bucket, windowStart + windowSeconds).run();
  const row = await env.DB.prepare('SELECT n FROM hits WHERE bucket = ?').bind(bucket).first();
  // Now and then, sweep away old windows so the table stays small.
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM hits WHERE expires < ?').bind(now).run();
  }
  return row && row.n > limit;
}

// =====================================================================
// SMALL HELPERS
// =====================================================================

// SHA-256 fingerprint of some text, as hex. (crypto.subtle is built in.)
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeParseArray(text) {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// Every answer is JSON, never cached, and never sniffed as anything else.
function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
