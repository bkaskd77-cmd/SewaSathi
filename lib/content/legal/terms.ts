import type { LocalisedDocument } from "@/lib/content/types";

/**
 * DRAFT — not reviewed by a lawyer.
 *
 * Written to describe what this product actually does rather than adapted from
 * a US SaaS template: phone-number identity, published price bands with an
 * on-site confirmation step, cash as a first-class payment method, and a
 * marketplace relationship where the professional is not our employee.
 *
 * It must be reviewed against Nepali consumer protection, e-commerce and
 * contract law before launch. See LAUNCH-BLOCKERS.md.
 */
export const terms: LocalisedDocument = {
  en: {
    title: "Terms of service",
    lead: "What you can expect from SajiloKaam, and what we expect from you. Written to be read, not to be skipped.",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are, and what this service is",
        blocks: [
          {
            p: "SajiloKaam is a booking platform based in Kathmandu. We connect people who need work done in their home with independent professionals — plumbers, electricians, cleaners, carpenters and the other trades listed on our services page.",
          },
          {
            p: "We are not the professional. The person who comes to your door runs their own business and does the work under their own responsibility. What we do is find them, check them, agree the price with you in advance, and stand behind the result under clause 7.",
          },
          {
            p: "These terms apply whenever you use the site or book through it. If you do not agree with them, please do not book.",
          },
        ],
      },
      {
        id: "your-account",
        heading: "Your account",
        blocks: [
          {
            p: "You sign in with your mobile number. We send a six-digit code by SMS and that code is your identity — there is no password to forget, and there is none to steal either.",
          },
          {
            p: "This means the phone matters. Anyone holding your unlocked phone can receive that code and book in your name. Keep it locked, and tell us straight away if you lose it or change your number.",
          },
          {
            p: "One mobile number is one account. You must be 18 or older to book, and the number you give us must be yours.",
          },
        ],
      },
      {
        id: "pricing",
        heading: "Prices, and the price you actually pay",
        blocks: [
          {
            p: "Every service has a published price band, shown before you book. Those bands are what our professionals genuinely charge for ordinary work in that trade — they are not an opening offer.",
          },
          {
            p: "You see an estimate before you confirm. The professional then sees the job in person, and this is the step that matters: if it is bigger than you described — a burst pipe rather than a dripping tap — they will explain why and give you a revised price. Work stops there until you agree to it.",
          },
          {
            p: "Nothing is added to your bill without your agreement. If you do not accept a revised price you may cancel at that point; a visit fee may apply under clause 5 to cover the trip.",
          },
          {
            p: "Prices cover labour and the call-out. A part the professional has to buy is quoted to you separately before it is fitted.",
          },
        ],
      },
      {
        id: "payment",
        heading: "Paying",
        blocks: [
          {
            p: "You pay after the work is finished. Never before.",
          },
          {
            ul: [
              "Cash to the professional on completion.",
              "eSewa or Khalti, through the app.",
            ],
          },
          {
            p: "We will never ask you for payment in advance, and no professional should ever ask you to send money outside the app or to a personal wallet. If someone does, do not pay, and tell us — it is the clearest sign that something is wrong.",
          },
        ],
      },
      {
        id: "cancellation",
        heading: "Changing your mind, and no-shows",
        blocks: [
          {
            p: "You can reschedule or cancel free of charge up to one hour before the agreed time, from the booking screen.",
          },
          {
            p: "Inside that hour, or if nobody is at the address when the professional arrives and we were not told, a small visit fee applies. It covers their travel and the time they held for you; it is not a penalty and it is not profit for us.",
          },
          {
            p: "If the professional cancels, or does not arrive, you pay nothing and we will find you someone else.",
          },
        ],
      },
      {
        id: "professionals",
        heading: "The professionals, and what we check",
        blocks: [
          {
            p: "Before anyone can take a job on SajiloKaam we check their government ID against their face in person, and we run a police record check through a verification partner. For the trade they register in, they also sit a practical skills assessment marked by a senior professional.",
          },
          {
            p: "Their profile shows which of those checks are complete and which are not. We show the gaps rather than hiding them, because a single “verified” badge tells you nothing about what was actually looked at.",
          },
          {
            p: "Ratings, completion rates and response times on a profile come from real finished bookings. They are not self-reported.",
          },
          {
            p: "Professionals are independent contractors, not our employees. We do not supervise how they carry out the work.",
          },
        ],
      },
      {
        id: "if-it-goes-wrong",
        heading: "If the work is not right",
        blocks: [
          {
            p: "Report it from the booking within 48 hours of the job finishing. We will send someone back to put it right at no extra cost to you.",
          },
          {
            p: "If it still is not resolved after that, we refund what you paid for the job. The details of how and when are in our refund policy.",
          },
          {
            p: "Complaints affect a professional's standing on the platform. Repeated ones affect whether they keep getting work, which is why the scores on their profiles are worth reading before you book.",
          },
        ],
      },
      {
        id: "safety",
        heading: "Safety, and what this service is not",
        blocks: [
          {
            p: "SajiloKaam is not an emergency service. If there is a fire, a gas leak you can smell, or somebody has been hurt, call the emergency services first — 101 for fire, 102 for an ambulance, 100 for police — and then deal with the booking.",
          },
          {
            p: "When you describe a problem, we may show you immediate safety guidance — switch off at the mains, do not light a flame, open the windows. That guidance is a precaution based on the words and the photo you gave us. It is general advice, it is not an inspection, and it does not replace your own judgement about whether it is safe to stay in the building.",
          },
        ],
      },
      {
        id: "using-the-service",
        heading: "Using the service properly",
        blocks: [
          { p: "When you use SajiloKaam, you agree not to:" },
          {
            ul: [
              "Book on behalf of someone else without telling us.",
              "Ask a professional to do work that is unsafe or illegal.",
              "Abuse, threaten or discriminate against anyone we send.",
              "Arrange work off the platform with a professional you met through it, in order to avoid our fees or our protections.",
              "Submit false reviews, or false reports of bad work.",
            ],
          },
          {
            p: "We may suspend an account that does any of these, and we will tell the account holder why.",
          },
        ],
      },
      {
        id: "liability",
        heading: "What we are responsible for",
        blocks: [
          {
            p: "We are responsible for running the platform: matching you fairly, showing accurate prices and profiles, and standing behind the work under clause 7.",
          },
          {
            p: "Where a professional causes damage in your home while carrying out a booking made through SajiloKaam, tell us within 48 hours and we will handle the claim with you rather than leaving you to argue it out with them.",
          },
          {
            p: "We are not responsible for work you arrange privately with a professional outside the platform, for pre-existing faults a repair happened to reveal, or for losses we could not reasonably have foreseen.",
          },
          {
            p: "Nothing in these terms limits any right you have under Nepali consumer law. Where the two conflict, the law wins.",
          },
        ],
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        blocks: [
          {
            p: "We will update these terms as the product changes. When a change materially affects you, we will tell you by SMS or in the app before it takes effect, and the date at the top of this page will change.",
          },
          {
            p: "Continuing to use SajiloKaam after that means you accept the updated terms.",
          },
        ],
      },
      {
        id: "law",
        heading: "Disputes and governing law",
        blocks: [
          {
            p: "Talk to us first. Most things are settled by a phone call, and the complaint route is on our help page.",
          },
          {
            p: "These terms are governed by the laws of Nepal, and the courts of Kathmandu have jurisdiction over any dispute arising from them.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "सेवाका सर्त",
    lead: "सजिलो कामबाट तपाईंले के अपेक्षा गर्न सक्नुहुन्छ, र हामी तपाईंबाट के अपेक्षा गर्छौं। पढ्नकै लागि लेखिएको हो, नाघेर जान होइन।",
    updated: "2026-08-29",
    draft: true,
    sections: [
      {
        id: "who-we-are",
        heading: "हामी को हौँ, र यो सेवा के हो",
        blocks: [
          {
            p: "सजिलो काम काठमाडौँमा आधारित बुकिङ प्लेटफर्म हो। घरको काम गर्नुपर्ने मानिस र स्वतन्त्र रूपमा काम गर्ने प्राविधिक — प्लम्बर, इलेक्ट्रिसियन, सफाइकर्मी, सिकर्मी र सेवा पृष्ठमा सूचीबद्ध अरू पेसा — बीच हामी जोड्ने काम गर्छौं।",
          },
          {
            p: "प्राविधिक हामी होइनौँ। तपाईंको ढोकामा आउने व्यक्तिले आफ्नै व्यवसाय चलाउनुहुन्छ र आफ्नै जिम्मेवारीमा काम गर्नुहुन्छ। हामीले गर्ने भनेको उहाँलाई खोज्ने, जाँच्ने, तपाईंसँग पहिल्यै मूल्य तय गर्ने, र दफा ७ अनुसार कामको नतिजाको जिम्मा लिने हो।",
          },
          {
            p: "साइट चलाउँदा वा यसबाट बुक गर्दा यी सर्त लागू हुन्छन्। मञ्जुर नभए कृपया बुक नगर्नुहोस्।",
          },
        ],
      },
      {
        id: "your-account",
        heading: "तपाईंको खाता",
        blocks: [
          {
            p: "तपाईं मोबाइल नम्बरबाट साइन इन गर्नुहुन्छ। हामी एसएमएसमा ६ अङ्कको कोड पठाउँछौं र त्यही कोड तपाईंको परिचय हो — बिर्सिने पासवर्ड छैन, र चोरिने पासवर्ड पनि छैन।",
          },
          {
            p: "यसैले फोन महत्त्वपूर्ण छ। तपाईंको अनलक फोन बोक्ने जोसुकैले त्यो कोड पाउन सक्छ र तपाईंकै नाममा बुक गर्न सक्छ। फोन लक गरेर राख्नुहोस्, र हरायो वा नम्बर फेरियो भने तुरुन्तै हामीलाई भन्नुहोस्।",
          },
          {
            p: "एउटा मोबाइल नम्बर बराबर एउटा खाता। बुक गर्न तपाईं १८ वर्ष पूरा भएको हुनुपर्छ, र दिनुभएको नम्बर तपाईंकै हुनुपर्छ।",
          },
        ],
      },
      {
        id: "pricing",
        heading: "मूल्य, र तपाईंले साँच्चै तिर्ने रकम",
        blocks: [
          {
            p: "हरेक सेवाको मूल्य दायरा बुक गर्नुअघि नै देखिन्छ। ती दायरा हाम्रा प्राविधिकले त्यो पेसाको सामान्य कामका लागि साँच्चै लिने रकम हुन् — मोलमोलाइको सुरुवाती अङ्क होइन।",
          },
          {
            p: "पुष्टि गर्नुअघि तपाईं अनुमानित रकम देख्नुहुन्छ। त्यसपछि प्राविधिकले काम आफ्नै आँखाले हेर्नुहुन्छ, र महत्त्वपूर्ण पाइला यही हो: तपाईंले भन्नुभएभन्दा ठूलो काम रहेछ भने — चुहिने धाराको सट्टा फुटेको पाइप — उहाँले कारणसहित नयाँ मूल्य भन्नुहुन्छ। तपाईंले मञ्जुर नगरेसम्म काम त्यहीँ रोकिन्छ।",
          },
          {
            p: "तपाईंको सहमतिबिना बिलमा केही थपिँदैन। नयाँ मूल्य मञ्जुर छैन भने त्यहीँ रद्द गर्न सक्नुहुन्छ; आउने खर्चबापत दफा ५ अनुसार भ्रमण शुल्क लाग्न सक्छ।",
          },
          {
            p: "मूल्यमा ज्याला र आउने शुल्क पर्छ। प्राविधिकले किन्नुपर्ने पार्ट्स जडान गर्नुअघि छुट्टै मूल्य भनिन्छ।",
          },
        ],
      },
      {
        id: "payment",
        heading: "भुक्तानी",
        blocks: [
          { p: "काम सकिएपछि मात्र तिर्नुहुन्छ। पहिले कहिल्यै होइन।" },
          {
            ul: ["काम सकिएपछि प्राविधिकलाई नगद।", "एपबाटै इसेवा वा खल्ती।"],
          },
          {
            p: "हामी कहिल्यै अग्रिम भुक्तानी माग्दैनौँ, र कुनै पनि प्राविधिकले एपबाहिर वा व्यक्तिगत वालेटमा पैसा पठाउन भन्नु हुँदैन। कसैले त्यसो भन्यो भने नतिर्नुहोस्, हामीलाई भन्नुहोस् — केही गडबड छ भन्ने त्यो सबैभन्दा प्रस्ट सङ्केत हो।",
          },
        ],
      },
      {
        id: "cancellation",
        heading: "मन फेरिए, र कोही नभेटिए",
        blocks: [
          {
            p: "तय भएको समयभन्दा एक घण्टा अगाडिसम्म बुकिङ पृष्ठबाट नि:शुल्क समय सार्न वा रद्द गर्न सकिन्छ।",
          },
          {
            p: "त्यो एक घण्टाभित्र, वा प्राविधिक आइपुग्दा ठेगानामा कोही नभेटिए र हामीलाई पहिले नभनिएको भए, सानो भ्रमण शुल्क लाग्छ। यसले उहाँको यातायात र तपाईंका लागि छुट्याइएको समय धान्छ; यो जरिवाना होइन, र हाम्रो नाफा पनि होइन।",
          },
          {
            p: "प्राविधिकले रद्द गर्नुभयो वा आउनुभएन भने तपाईंले केही तिर्नु पर्दैन, र हामी अर्को व्यक्ति खोजिदिन्छौं।",
          },
        ],
      },
      {
        id: "professionals",
        heading: "प्राविधिक, र हामीले जाँच्ने कुरा",
        blocks: [
          {
            p: "सजिलो काममा काम लिनुअघि हामी सरकारी परिचयपत्र भेटेरै अनुहारसँग मिलाएर हेर्छौं, र प्रमाणीकरण साझेदारमार्फत प्रहरी अभिलेख जाँच गर्छौं। दर्ता भएको पेसाको व्यावहारिक सीप परीक्षा पनि हुन्छ, जुन वरिष्ठ प्राविधिकले जाँच्नुहुन्छ।",
          },
          {
            p: "कुन जाँच पूरा भयो र कुन भएन, प्रोफाइलमै देखिन्छ। हामी नभएका कुरा लुकाउँदैनौँ — एउटै “प्रमाणित” चिह्नले साँच्चै के हेरियो भन्ने केही बताउँदैन।",
          },
          {
            p: "प्रोफाइलमा देखिने रेटिङ, काम पूरा गर्ने दर र जवाफ दिने समय साँच्चै सकिएका बुकिङबाट आउँछन्। आफैँले भनेको दाबीबाट होइन।",
          },
          {
            p: "प्राविधिक स्वतन्त्र ठेकेदार हुनुहुन्छ, हाम्रो कर्मचारी होइन। काम कसरी गर्ने भन्नेमा हामी निगरानी गर्दैनौँ।",
          },
        ],
      },
      {
        id: "if-it-goes-wrong",
        heading: "काम राम्रो भएन भने",
        blocks: [
          {
            p: "काम सकिएको ४८ घण्टाभित्र बुकिङबाटै जानकारी दिनुहोस्। हामी थप शुल्कबिना मिलाउन फेरि पठाउँछौं।",
          },
          {
            p: "त्यसपछि पनि मिलेन भने काम बापत तिर्नुभएको रकम फिर्ता गर्छौं। कसरी र कहिले भन्ने विवरण हाम्रो रकम फिर्ता नीतिमा छ।",
          },
          {
            p: "उजुरीले प्लेटफर्ममा प्राविधिकको स्थानमा असर पार्छ। बारम्बार उजुरी आए काम पाउने कि नपाउने भन्नेमै असर पर्छ — त्यसैले बुक गर्नुअघि प्रोफाइलका अङ्क पढ्न लायक हुन्छन्।",
          },
        ],
      },
      {
        id: "safety",
        heading: "सुरक्षा, र यो सेवा के होइन",
        blocks: [
          {
            p: "सजिलो काम आपत्कालीन सेवा होइन। आगलागी भएको छ, ग्यासको गन्ध आइरहेको छ, वा कोही घाइते हुनुभएको छ भने पहिले आपत्कालीन सेवालाई फोन गर्नुहोस् — आगलागीका लागि १०१, एम्बुलेन्सका लागि १०२, प्रहरीका लागि १०० — त्यसपछि मात्र बुकिङ हेर्नुहोस्।",
          },
          {
            p: "समस्या भन्नुहुँदा हामी तत्काल गर्नुपर्ने सुरक्षा सल्लाह देखाउन सक्छौं — मेन स्विच बन्द गर्नुहोस्, आगो नबाल्नुहोस्, झ्याल खोल्नुहोस्। त्यो सल्लाह तपाईंले दिनुभएको शब्द र फोटोमा आधारित सावधानी हो। यो सामान्य सल्लाह हो, निरीक्षण होइन, र भवनमा बस्न सुरक्षित छ कि छैन भन्ने तपाईंकै निर्णयको ठाउँ लिँदैन।",
          },
        ],
      },
      {
        id: "using-the-service",
        heading: "सेवाको ठीक प्रयोग",
        blocks: [
          { p: "सजिलो काम चलाउँदा तपाईं यी कुरा नगर्ने सहमति जनाउनुहुन्छ:" },
          {
            ul: [
              "नभनी अरू कसैको तर्फबाट बुक गर्ने।",
              "प्राविधिकलाई असुरक्षित वा गैरकानुनी काम गर्न लगाउने।",
              "हामीले पठाएको जोसुकैलाई दुर्व्यवहार, धम्की वा भेदभाव गर्ने।",
              "हाम्रो शुल्क वा हाम्रो सुरक्षाबाट उम्कन, यहीँ भेटेको प्राविधिकसँग प्लेटफर्मबाहिर काम मिलाउने।",
              "झुटा समीक्षा वा खराब कामको झुटा उजुरी हाल्ने।",
            ],
          },
          {
            p: "यीमध्ये कुनै गर्ने खाता हामी निलम्बन गर्न सक्छौं, र किन गरियो भनी खातावालालाई बताउँछौं।",
          },
        ],
      },
      {
        id: "liability",
        heading: "हामी केको जिम्मेवार छौँ",
        blocks: [
          {
            p: "प्लेटफर्म चलाउने जिम्मा हाम्रो हो: निष्पक्ष रूपमा जोड्ने, सही मूल्य र सही प्रोफाइल देखाउने, र दफा ७ अनुसार कामको जिम्मा लिने।",
          },
          {
            p: "सजिलो कामबाट गरिएको बुकिङमा प्राविधिकले तपाईंको घरमा क्षति गर्नुभयो भने ४८ घण्टाभित्र हामीलाई भन्नुहोस् — तपाईंलाई उहाँसँग विवाद गर्न छोड्ने होइन, दाबी हामी तपाईंसँगै मिलाउँछौं।",
          },
          {
            p: "प्लेटफर्मबाहिर निजी रूपमा मिलाएको काम, मर्मत गर्दा देखिन आएको पहिल्यैको बिग्रिएको अवस्था, वा हामीले उचित रूपमा अनुमान गर्नै नसक्ने क्षतिको जिम्मा हामी लिँदैनौँ।",
          },
          {
            p: "यी सर्तले नेपाली उपभोक्ता कानुनले दिएको कुनै पनि अधिकारलाई घटाउँदैनन्। दुवैबीच बाझिए कानुन नै मान्य हुन्छ।",
          },
        ],
      },
      {
        id: "changes",
        heading: "सर्तमा हुने परिवर्तन",
        blocks: [
          {
            p: "उत्पादन बदलिँदै जाँदा यी सर्त पनि अद्यावधिक हुन्छन्। तपाईंलाई उल्लेख्य असर पर्ने परिवर्तन भए लागू हुनुअघि एसएमएस वा एपबाटै जानकारी दिन्छौं, र माथिको मिति फेरिन्छ।",
          },
          {
            p: "त्यसपछि पनि सजिलो काम चलाइरहनुभयो भने अद्यावधिक सर्त स्वीकार गर्नुभएको मानिन्छ।",
          },
        ],
      },
      {
        id: "law",
        heading: "विवाद र लागू हुने कानुन",
        blocks: [
          {
            p: "पहिले हामीसँग कुरा गर्नुहोस्। धेरैजसो कुरा एउटा फोनमै मिल्छ, र उजुरीको बाटो हाम्रो सहयोग पृष्ठमा छ।",
          },
          {
            p: "यी सर्त नेपालको कानुनअनुसार सञ्चालित हुन्छन्, र यीबाट उत्पन्न विवादमा काठमाडौँका अदालतको क्षेत्राधिकार रहन्छ।",
          },
        ],
      },
    ],
  },
};
