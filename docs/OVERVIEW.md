# Golden Auto Video Studio — what it is and how it is used

Start here if you are new to the project (a teammate or a new Claude Code session). This page explains what the
website is for and how people use it. The technical details are in [README.md](../README.md), the rules for working on
the code in [CLAUDE.md](../CLAUDE.md), and the current status in [docs/HANDOFF.md](HANDOFF.md).

## What it is for

Golden Auto is a used-car dealership in San Ramon, California (mygoldenauto.net). Video Studio is its private website
for turning the cars it has for sale into short advertising videos for Instagram and Facebook: a presenter walks around
the real car and talks about it, with captions, the price and the dealership's website.

Making these by hand takes a person, a camera and editing time for every car. The studio does it from the inventory
listing: pick a car, check the words, approve the voice, and pay for one AI-generated video. The finished video, with
captions, is ready to download a few minutes later.

The studio can also make videos for **other dealerships** ("clients"). Each client has its own cars, voice previews
and videos. eLease Returns (eleasereturns.com) has been added as a second client on staging; production has Golden
Auto only so far.

## Who uses it

- **The dealership team** (Golden Auto staff, Sawyer, Mark): make and download videos, post them on social media.
- **Developers** (the team, with Claude Code) keep the code running on the company's Ubuntu server.

**Accounts.** Everyone signs in with their own email and password. There is no registration page: an admin adds
people under Admin → Manage users and chooses their role and which clients they may use:

| Role | Can do |
| --- | --- |
| Admin | Everything, plus managing users, clients and the shared spokesperson library |
| User | Makes videos for their assigned clients, including paid steps |
| Viewer | Sees cars and downloads finished videos for their clients; changes nothing |

Every paid video and voice preview records who approved it. Admins see who did what under Admin → Usage dashboard (paid activity per day, estimated spend per user and client, sign-ins, recent activity). Each site (production, staging) has its own accounts;
on a site with no accounts yet, the first sign-in with an email and the old shared dashboard password creates the
first admin.

## The two websites

| Site | Address | Used for |
| --- | --- | --- |
| Production | https://video.mygoldenauto.net:4343 | The real studio. Real cars, real videos. |
| Staging | https://staging.mygoldenauto.net:4343 | A test copy (orange "STAGING" banner). New features are tried here first. |

Both cost real money when a paid video or voice is generated, staging included. Changes go to staging first and to
production only after they have been checked there.

## How a video is made (the dashboard, step by step)

1. **Vehicle.** Choose the client and a car from its inventory. The car list comes from the dealer's website or its
   DealerCenter account (Golden Auto's dealer software); prices, mileage and photos come with it.
2. **Script.** The studio writes what the presenter will say (15 or 30 seconds) from the listing: the car, a few
   features, the price ("Just $14,688") and "Book your test drive today at mygoldenauto.net". Anyone can edit it. A
   counter shows the spoken word count (55–60 words fit 30 seconds).
3. **Voice.** Make a voice preview of the script with ElevenLabs (a paid voice service, a few cents each), listen to all
   of it and approve it. Numbers and codes are written out for the voice ("twenty thirteen", "S-U-V"); the captions keep
   the normal spelling.
4. **Look.** Choose the presenter (a photo of a real person who agreed to appear), the style and the format (Reels 9:16,
   Feed 4:5 or Square). The car's real photos are put together into one "asset sheet" so the video shows the actual car.
   Alternative: **My footage** — upload a phone video of the car instead of an AI video (free, no presenter).
5. **Generate.** Tick the approval boxes and generate. One AI video (Seedance 2.5 through Higgsfield) costs about
   **$9.71** for 30 seconds. Nothing paid ever happens without its own ticked approval.
6. **Videos.** A few minutes later the video is ready. The server adds captions timed to the presenter's actual speech
   and lists it as "Ready" with a download button. Captions can be corrected and the video re-rendered for free.

Messages appear as pop-ups in the bottom-right corner. Problems stay on screen until dismissed and are listed under
**Notifications** at the top.

## Rules that matter to the business

- **Prices:** the highest advertised price is used and said as "Just $14,688". A car without a price never mentions one;
  its captions say "Call For Price".
- **Nothing is paid without approval:** every paid step has its own checkbox, the same request is never sent twice by
  accident, and a request whose outcome is unclear is never retried automatically.
- **The car must still be for sale:** the user confirms the car is available and the price is current before a paid video.
- **Captions show exactly the approved text**, even when the AI presenter adds or repeats words.
- **People in videos must have agreed to appear.** Only upload presenter photos with their permission.
- **Secrets stay private:** passwords and service keys live only on the server (`private/config.json`), never in the code.

## Where the cars come from

- **Golden Auto:** its website blocks the server, so the car list is copied from the public website in a browser and
  loaded with a sync tool; photos download directly from DealerCenter. A daily automatic feed (DealerCenter SFTP) is a
  planned improvement.
- **Other clients:** added in the dashboard with their website address. The studio checks the site and imports the cars
  where it can (for example sites built on Dealer Car Search, like eLease Returns), keeping only outside photos of the car.
- **Manual:** any car can be added with a DealerCenter photo ZIP and its details.

## Costs at a glance

| Step | Service | Cost |
| --- | --- | --- |
| Voice preview | ElevenLabs | a few cents per preview |
| AI video | Higgsfield (Seedance 2.5) | about $9.71 per 30-second video |
| Lip-sync (older method) | fal.ai | per request |
| Captions, photos, My footage, re-renders | the studio's own server | free |

## How it is built (one paragraph)

A Node.js service with a React dashboard runs on the company's Ubuntu server behind Nginx; data is in a SQLite file; a
few Python helpers and the free tools FFmpeg and whisper.cpp handle video, captions and photo sorting; two background
workers run every minute (captions and final videos; photo sorting). The code is on GitHub
(`mlemmo/Golden-Auto-Video-Production`): branch `staging` for the test site, `main` for production. Details: README.md
(layout, running locally), docs/DEPLOY_UBUNTU.md (deploying), docs/STAGING.md (the two sites).

## Words you will see

- **Client:** a dealership the studio makes videos for (Golden Auto is the first).
- **Asset sheet:** one image of 4–9 real photos of the car, sent to the AI so the video shows the right car.
- **Voice preview / narration:** the ElevenLabs recording of the script that guides the presenter's voice and words.
- **Spoken text vs caption text:** what the voice says (with respellings) and what appears on screen (normal spelling).
- **Seedance / Higgsfield:** the AI video model and the service that runs it.
- **Caption worker / photo worker:** the background jobs that finish videos and sort imported photos.
- **Staging / production:** the test site and the real site.
