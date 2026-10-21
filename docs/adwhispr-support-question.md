Subject: Agency plan "API Access" — launching Meta and TikTok ads from our own app

Hi AdWhispr team,

We run a video studio for car dealerships (Golden Auto and other dealers). Our dashboard makes short vehicle videos,
and we would like each dealer's videos to become paid ads on Meta (Facebook/Instagram) and TikTok through AdWhispr.
Today we launch them through your MCP connector in Claude, which works well. We would now like our own server to do
this directly, and saw that the Agency plan lists "API Access". Could you tell us:

1. What the Agency plan's API Access is: a REST API with API keys, the MCP endpoint (https://adwhispr.com/api/mcp)
   used by a server with a long-lived token, or something else? Is there documentation?
2. Whether it can do what we use the connector for: launch a paused video ad on Meta (video by URL, radius targeting
   around an address, traffic objective, Page choice) and on TikTok, resume/pause campaigns, and read performance
   (spend, impressions, clicks) per campaign.
3. How it works with several dealers: one AdWhispr account with each dealer's Meta and TikTok ad accounts connected
   (we have partner access to them), or one AdWhispr workspace/brand per dealer? Can an API call choose the ad account?
4. How authentication works for a server (API key, OAuth client credentials, token lifetime and refresh), and whether
   the two-step preview/confirmToken flow is required over the API.
5. Rate limits, and whether API launches count against the plan's "agent calls".
6. Whether we can try the API before upgrading.

Thank you,
Mark Lemmo
Golden Auto — mark@eshieldpro.com
