import type { LocalisedDocument } from "@/lib/content/types";

export const help: LocalisedDocument = {
  en: {
    title: "Help centre",
    lead: "The things people ask most, and where to go when the answer is not here.",
    updated: "2026-08-29",
    sections: [
      {
        id: "booking",
        heading: "Booking",
        blocks: [
          {
            dl: [
              {
                term: "How do I book?",
                detail:
                  "Describe the problem on the home page in your own words, or pick a service. You will see the trade, the price band and who is available, then confirm.",
              },
              {
                term: "Do I need an account?",
                detail:
                  "To book, yes — the professional needs a name and a number to arrive at. Signing in is your mobile number and a six-digit code. There is no password.",
              },
              {
                term: "Can I book for someone else?",
                detail:
                  "Yes, but put their number in the booking so the professional can reach the person who will actually be there.",
              },
            ],
          },
        ],
      },
      {
        id: "price",
        heading: "Prices and paying",
        blocks: [
          {
            dl: [
              {
                term: "Is the price on the card the final price?",
                detail:
                  "It is the band for that kind of job. The professional confirms the exact figure after seeing the work, and you approve anything above the estimate before they carry on.",
              },
              {
                term: "When do I pay?",
                detail:
                  "After the work is finished. Cash, eSewa or Khalti. We never ask for payment in advance.",
              },
              {
                term: "Someone asked me to pay them directly.",
                detail:
                  "Do not. No professional should ask you to send money outside the app. Tell us — that request is the clearest sign something is wrong.",
              },
            ],
          },
        ],
      },
      {
        id: "codes",
        heading: "Sign-in codes",
        blocks: [
          {
            dl: [
              {
                term: "The SMS has not arrived.",
                detail:
                  "Delivery to NTC and Ncell can take up to a minute where coverage is poor. Check the number you typed, move somewhere with signal, and wait. If it still does not come, call us and we will book it for you by phone.",
              },
              {
                term: "I have changed my number.",
                detail:
                  "Call us. Your bookings are tied to the old number and we move them across by hand for now.",
              },
            ],
          },
        ],
      },
      {
        id: "elsewhere",
        heading: "Not answered here",
        blocks: [
          {
            p: "To complain about a job that has already happened, use the complaint route — it has its own timescales. For anything else, the contact page has the phone number and the hours.",
          },
        ],
      },
    ],
  },
  ne: {
    title: "सहयोग केन्द्र",
    lead: "मानिसले सबैभन्दा धेरै सोध्ने कुरा, र जवाफ यहाँ नभेटिए कहाँ जाने।",
    updated: "2026-08-29",
    sections: [
      {
        id: "booking",
        heading: "बुकिङ",
        blocks: [
          {
            dl: [
              {
                term: "कसरी बुक गर्ने?",
                detail:
                  "गृहपृष्ठमा आफ्नै शब्दमा समस्या लेख्नुहोस्, वा सेवा छान्नुहोस्। कुन पेसा चाहिन्छ, मूल्य दायरा र को उपलब्ध हुनुहुन्छ देखिन्छ, अनि पुष्टि गर्नुहोस्।",
              },
              {
                term: "खाता चाहिन्छ?",
                detail:
                  "बुक गर्न चाहिन्छ — प्राविधिकलाई आइपुग्न नाम र नम्बर चाहिन्छ। साइन इन भनेको मोबाइल नम्बर र ६ अङ्कको कोड हो। पासवर्ड छैन।",
              },
              {
                term: "अरू कसैका लागि बुक गर्न मिल्छ?",
                detail:
                  "मिल्छ, तर बुकिङमा उहाँकै नम्बर राख्नुहोस्, ताकि प्राविधिकले त्यहाँ हुने व्यक्तिलाई नै सम्पर्क गर्न सकून्।",
              },
            ],
          },
        ],
      },
      {
        id: "price",
        heading: "मूल्य र भुक्तानी",
        blocks: [
          {
            dl: [
              {
                term: "कार्डमा देखिने मूल्य अन्तिम हो?",
                detail:
                  "त्यो त्यस्तै कामको दायरा हो। प्राविधिकले काम हेरेपछि ठ्याक्कै रकम पक्का गर्नुहुन्छ, र अनुमानभन्दा बढी हुने भए तपाईंले मञ्जुर गरेपछि मात्र अघि बढ्नुहुन्छ।",
              },
              {
                term: "कहिले तिर्ने?",
                detail:
                  "काम सकिएपछि। नगद, इसेवा वा खल्ती। हामी अग्रिम भुक्तानी कहिल्यै माग्दैनौँ।",
              },
              {
                term: "कसैले सिधै आफूलाई तिर्न भन्यो।",
                detail:
                  "नतिर्नुहोस्। कुनै पनि प्राविधिकले एपबाहिर पैसा पठाउन भन्नु हुँदैन। हामीलाई भन्नुहोस् — त्यस्तो माग नै केही गडबड छ भन्ने सबैभन्दा प्रस्ट सङ्केत हो।",
              },
            ],
          },
        ],
      },
      {
        id: "codes",
        heading: "साइन इन कोड",
        blocks: [
          {
            dl: [
              {
                term: "एसएमएस आएन।",
                detail:
                  "नेटवर्क कमजोर ठाउँमा एनटीसी र एनसेलमा कोड आइपुग्न एक मिनेटसम्म लाग्न सक्छ। हाल्नुभएको नम्बर जाँच्नुहोस्, सिग्नल भएको ठाउँमा जानुहोस्, र पर्खनुहोस्। त्यसपछि पनि आएन भने फोन गर्नुहोस्, हामी फोनबाटै बुक गरिदिन्छौं।",
              },
              {
                term: "मैले नम्बर फेरेको छु।",
                detail:
                  "फोन गर्नुहोस्। तपाईंका बुकिङ पुरानै नम्बरसँग जोडिएका छन्, र अहिलेलाई हामी हातैले सार्छौं।",
              },
            ],
          },
        ],
      },
      {
        id: "elsewhere",
        heading: "यहाँ जवाफ भेटिएन भने",
        blocks: [
          {
            p: "भइसकेको कामबारे उजुरी गर्न उजुरीको बाटो प्रयोग गर्नुहोस् — त्यसका आफ्नै समयसीमा छन्। अरू कुनै कुराका लागि सम्पर्क पृष्ठमा फोन नम्बर र समय छ।",
          },
        ],
      },
    ],
  },
};
