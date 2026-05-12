# Like Every Cloud — Project Brief & Director Notes

## Brief from directors

**LIKE EVERY CLOUD |||| زي كل غيمة**

An interactive cassette tape studio — a time capsule from early 2000s Chad — where the visitor not only gets to sample music but also piece together a context and narrative about the space by engaging with objects in the room. Currently teetering in the balance between offering a "sonic vibe" for the user (Can they select more than one tape off the wall? Can they select whole albums? Can they just sit in the space with ambient noise from the nearby streets without having to choose a cassette?) and a linear narrative of loss (of livelihood, of experience, of music).

### Format

A 3D model of a cassette tape studio, ideally starting outside (think establishing shot) and then entering. Doesn't need to be full 6DOF outside the shop, can just be a slight "turn your neck this way and that way" view from the corner before clicking to "enter" (similar to the approach to the desk in an interactive portfolio reference). Once inside, we do not yet have a leaning toward full 6DOF or point-and-click to change POV (think post-Myst: facing one way, then the other, then the window) to click on objects around the room; this will be determined while prototyping and user-testing. What we do know is that objects will be used to tell a story (non-linear), perhaps amid spaced-out narrative soundbites from studio owner Annour (linear, but not overbearing, similar to the narrations in *Bear 71*). At some point, the hubbub of prime studio days has faded away and the beats of the cassettes are replaced by the soft purr of Annour's sewing machine, a technological relic of his past career reemerging as the cassette era — "like every cloud" in the song by Chadian-Sudanese singer Majzoub Ounsa — has come and gone.

### Music

Rather than shy away from the context behind the music, it is a key element that this studio exists in the borderland between Chadian and Sudanese music. A number of Chadian singers (Souradjadine, Mahamat Moudassir, Aziz Adoum Maryoud) studied music in Sudan and were key figures in Chadian contemporary music's overall shift from big band (percussion, oud, saxophone, violins, accordion, keys) to smaller scale (and much cheaper) synthesizer-singer outfits, a transition noticeable in the music itself.

There is a bit of anxiety around the loss of musical archive in neighboring Sudan with the ongoing war. Perhaps despite their intentions, archivists and musical promoters wind up flattening the narrative around Sudanese music to "can you believe Sudanese music is actually good?" and "we must preserve our wonderful culture," narratives that indirectly serve nationalism, something we want to contest: the music in our project is evidence that music transcends singular narratives around nationality and culture. And specifically, given the blame many Sudanese (even progressives!) assign to Chadians for being the cause of the war in Sudan (there is a line that "these people can't be Sudanese; Sudanese aren't violent!") it is of note that some of the most active Sudanese musical archives actually existed in neighboring countries like Chad. To attack Chadians is, in a way, an acceptance of colonial narratives that people on one side of the border are different from people on another side of the border. This cassette studio is a "fuck you" to that way of thinking, a chance to challenge rigid narratives around identity and celebrate musical cultures that transcend borders.

All this said, we will need to have a conversation about what music we can actually use in the project. Options under consideration:

- **12-second fair-use samples** — safest; "educational" framing
- **License individual tracks** — particularly complicated in Sudan, where the composer often has more ownership than the performer who made it famous
- **Whole licensed albums** via Ostinato or Habibi Funk for true jukebox feel — politically loaded; Sudan Tapes Archive has criticized these labels for not being Sudanese
- **Backdoor option:** only license songs from people Bentley knows (and in one case performed with) from the "that one party" genre. Sudanese audiences will see themselves in this music but the claim is not "Sudanese music" since the artists are Chadian.

### Hero objects in the studio

Each needs an interactive model, logic, animations, and bespoke sound.

- Calendar (maybe listing gigs? travel plans? upcoming weddings?)
- Annour's laptop (presumably no internet connection apart from occasional hotspot-ing)
- Phone charging station (people leave their phones to charge for a nominal fee)
- Cassettes stacked on the wall
- Stereo player (dual cassette deck)
- Sewing machine
- Sitaara (the fabric hugging the walls that acts as a sort of wallpaper but also can be moved)
- Recently sewn/embroidered clothes hanging on a line
- Motorcycle keys (plus generator key, same ring)
- Motorcycle
- Generator
- Green tea glass (tea is brewed so strong it looks brown)

---

## Director session notes — 2026-05-11

### Scene & interaction
- Finding clues throughout the space drives non-linear storytelling
- Sound was historically projected outside via massive speakers
- Two jukeboxes are part of the setup
- When you came in to sample music, Annour would play it full blaring
- When trying a cassette, it plays out loud through the shop
- Boombox is a dual-head stereo device — copies cassettes in real-time, or records radio live, or copies at faster speed
- *Idea:* record the radio
- Cassettes on the wall are deliberately *not* over-organized — currently model is too neat
- Sometimes vertical, sometimes horizontal; handwritten Chadian-style labels
- Music is more related to Sudan & Chad — *not* a preservation pitch
- Sudan Tapes Archive is the cleanest organized online archive; we explicitly are not doing that
- User can take a cassette off the wall and play it
- Design intent: ability to add more music and albums over time (data-driven, extensible)
- Bentley has a large Chadian music database, just needs permission requests
- Design note: find cassettes and play them — full db of songs

### Emotional core
- Convey heartbreak in the *present* state
- Core arc: the coming and going of a music tech AND of the person who did it; what's lost is the songs that didn't get digitized

### Sound design palette
- Magnetic tape
- Cassette sound
- Sewing machine sound (makes a rhythm — structures the present-state soundscape)

### Possible UI
- Winamp-style (or find the program they actually used) listing of all tracks
- Shared ratings and comments
- Consider anchoring this UI to the laptop in the *present* state
- Allow downloads? Allow tipping?

---

## Development implications

(These are technical notes derived from the brief, not part of the directors' input.)

- **Camera architecture grows.** Confirmed flow: external establishing view (constrained rotation, not full 6DOF) → click to enter → internal exploration. Internal mode is TBD between full 6DOF and point-and-click POV. The existing pluggable `CameraMode` system supports this — add `external-view` and `point-and-click` modes alongside `freeform` / `rails-*`.
- **Hero count revised upward to 12.** Earlier scaffolding assumed a handful; needs to scale. Manifest schema should be data-driven, not per-object code.
- **Cassettes-on-wall is its own subsystem.** Likely 50+ pickable items, each backed by an audio track. Needs an asset and data structure independent of the hero pattern — closer to a database query than a manifest.
- **Audio system is multi-channel.** Ambient (street, sewing machine), music (currently selected cassette/radio), narration (Annour soundbites), interactive (cassette mechanics, button clicks). Design this before code.
- **State arc has emotional weight.** Past = full studio operating, sound blasting; present = sewing machine purrs, music has faded. The `userData.state` tagging system already supports the binary; the transition UX needs to carry the feeling, not just toggle visibility.
- **Music licensing is gating for release, not for prototype.** Proceed with Bentley-permitted or CC-licensed placeholder audio. Resolve licensing before public release.
