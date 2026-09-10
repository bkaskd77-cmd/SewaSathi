import type { LocalisedDocument } from "@/lib/content/types";

/**
 * DRAFT — not reviewed by a lawyer. See LAUNCH-BLOCKERS.md.
 *
 * Deliberately short. A refund policy is read by somebody who is already
 * unhappy, and length reads as evasion.
 */
export const refunds: LocalisedDocument = {
  en: {
    title: "Refund policy",
    lead: "You pay after the work is done, so most of this is about the few times something still goes wrong.",
    updated: "2026-09-06",
    draft: true,
    sections: [
      {
        id: "when-you-pay",
        heading: "When you pay",
        blocks: [
          {
            p: "After the work is finished, never before. That is the whole basis of this policy: in almost every case there is nothing to refund, because you have not paid yet.",
          },
          {
            p: "If the professional finds the job is bigger than described, you approve the new price before they carry on. If you do not approve it, you have not agreed to that price and you do not owe it.",
          },
        ],
      },
      {
        id: "cancelling",
        heading: "Cancelling",
        blocks: [
          {
            p: "Free, from the booking screen, until your professional sets off. Nothing has been paid, so nothing is refunded.",
          },
          {
            p: "Once somebody is on their way we cannot cancel it from the screen — call us and we will sort it out. Either way there is no cancellation charge: we take our money after the work is done, so there is nothing for us to collect.",
          },
          {
            p: "If nobody is at the address when the professional arrives and we were not told, your first time costs you nothing. We pay them for the wasted trip ourselves, because they did the work of turning up and somebody should. If it keeps happening, that trip cost is added to your next booking, a quarter of the bill at a time — never chased any other way, and written off if you do not book again.",
          },
          {
            p: "If the professional cancels or does not turn up, you pay nothing and we find you someone else.",
          },
        ],
      },
      {
        id: "guarantee",
        heading: "The guarantee, and who pays for it",
        blocks: [
          {
            p: "If the same fault comes back within the window for that service, we send somebody back and you pay nothing. That is the whole promise: the work put right, against the amount recorded for the job.",
          },
          {
            dl: [
              {
                term: "Repairs — plumbing, electrical, appliances, AC, carpentry, water tanks",
                detail: "30 days. A repair that holds for a month held.",
              },
              {
                term: "Painting",
                detail:
                  "90 days. Peeling and blistering take weeks to show, so a shorter window would not be worth having.",
              },
              {
                term: "Pest control",
                detail:
                  "30 days. This trade sells a course of treatment rather than one visit, so a follow-up is usually the treatment working normally, not a failure.",
              },
              {
                term: "Home cleaning",
                detail:
                  "48 hours, and we re-clean. Anything longer would be pretending a house does not get dirty again.",
              },
              {
                term: "Movers and packers",
                detail:
                  "48 hours to report transit damage. It is found on unpacking, and after that nobody can say it happened in the van.",
              },
            ],
          },
          {
            p: "Every claim sends a professional out, and what they find decides who pays for the visit. You agree to this before we send anyone, so there is never a bill you did not see coming:",
          },
          {
            ul: [
              "They find the same fault: you pay nothing. The visit is borne by the professional who did the original job, not by you.",
              "They find a different problem: it becomes an ordinary booking at the usual price, and you see the quote before they start work.",
              "They find nothing wrong: the same — an ordinary visit at the usual price.",
              "The damage was caused after we left: the same.",
            ],
          },
          {
            p: "We do it this way because going and looking is the only honest way to tell those apart. A blocked drain a fortnight after a tap was fixed is a new job rather than the old one coming back, and the person standing in your kitchen is the one who can say which it is.",
          },
          {
            p: "Two claims per booking, one open at a time, on a job that is finished and paid for. After that it is a phone call with a person rather than a form.",
          },
        ],
      },
      {
        id: "guarantee-limits",
        heading: "What the guarantee does not cover",
        blocks: [
          {
            ul: [
              "A different fault from the one that was fixed. That is a new job, and we will quote it before anyone starts.",
              "Damage the fault caused, as opposed to the fault itself — the water from the leak, the food spoiled by the outage. We put the work right; we do not cover what it damaged. This is the most important line on this page and we would rather you read it now than discover it later.",
              "Damage caused by you, by somebody else, or by ordinary use after the job.",
              "Parts you supplied yourself, and things that wear out — filters, washers, bulbs.",
              "Work you were advised to have done and chose not to. If the pipe needed replacing and you asked for a patch, the patch failing is not a defect.",
              "Anything somebody else has worked on since.",
            ],
          },
        ],
      },
      {
        id: "how-refunds-arrive",
        heading: "How a refund reaches you",
        blocks: [
          {
            p: "First, how one is decided: by a person, and only after somebody has been out and confirmed the fault was ours and cannot be put right. Nothing in the app produces a refund on its own. It is capped at the amount recorded for the job — which is why the figure you enter after paying cash matters.",
          },
          {
            dl: [
              {
                term: "Paid by eSewa or Khalti",
                detail:
                  "Reversed to the same wallet. We start it within 2 working days; the wallet usually shows it within 5.",
              },
              {
                term: "Paid in cash",
                detail:
                  "We send it to your eSewa or Khalti account, or you can collect it in cash from our office. Your choice, and we will ask rather than assume.",
              },
            ],
          },
        ],
      },
      {
        id: "not-refundable",
        heading: "What we cannot refund",
        blocks: [
          {
            ul: [
              "Parts already bought and fitted at your request, where the part itself is not faulty.",
              "Work you approved a revised price for, carried out as agreed, that you later changed your mind about.",
              "Damage that was already there and that the repair simply revealed.",
              "Work arranged privately with a professional outside SajiloKaam.",
            ],
          },
          {
            p: "If you disagree with any of these in your case, say so. These are rules of thumb, not a wall.",
          },
        ],
      },
      {
        id: "how-to-ask",
        heading: "How to ask",
        blocks: [
          {
            p: "Open the booking and report the problem, or call the number on our contact page. Tell us what was agreed, what happened, and what you would like done. We aim to answer within one working day.",
          },
          {
            p: "Nothing here limits your rights under Nepali consumer law.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "रकम फिर्ता नीति",
    lead: "तपाईं काम सकिएपछि तिर्नुहुन्छ, त्यसैले यो नीति प्रायः थोरै पटक बिग्रिने अवस्थाबारे हो।",
    updated: "2026-09-06",
    draft: true,
    sections: [
      {
        id: "when-you-pay",
        heading: "कहिले तिर्नुहुन्छ",
        blocks: [
          {
            p: "काम सकिएपछि, पहिले कहिल्यै होइन। यही नै यो नीतिको आधार हो: झन्डै हरेक अवस्थामा फिर्ता गर्नुपर्ने केही हुँदैन, किनभने तपाईंले तिर्नै भएको हुँदैन।",
          },
          {
            p: "भनेभन्दा ठूलो काम रहेछ भने प्राविधिकले अघि बढ्नुअघि तपाईंले नयाँ मूल्य मञ्जुर गर्नुहुन्छ। मञ्जुर गर्नुभएन भने त्यो मूल्यमा सहमति भएकै होइन, र तिर्नु पनि पर्दैन।",
          },
        ],
      },
      {
        id: "cancelling",
        heading: "रद्द गर्दा",
        blocks: [
          {
            p: "प्राविधिक नआउन्जेल बुकिङ पृष्ठबाटै नि:शुल्क रद्द गर्न सकिन्छ। केही तिरिएकै छैन, त्यसैले फिर्ता गर्नुपर्ने पनि केही छैन।",
          },
          {
            p: "उहाँ हिँडिसकेपछि भने पृष्ठबाट रद्द हुँदैन — हामीलाई फोन गर्नुहोस्, मिलाइदिन्छौँ। जे भए पनि रद्द गरेबापत शुल्क लाग्दैन: हामी काम सकिएपछि मात्र पैसा लिन्छौँ, त्यसैले असुल्नुपर्ने केही हुँदैन।",
          },
          {
            p: "हामीलाई नभनी ठेगानामा कोही नभेटिए, तपाईंको पहिलो पटक नि:शुल्क हुन्छ। खेर गएको फेराको पैसा हामी आफैँ तिरिदिन्छौँ, किनभने आउने काम त उहाँले गर्नुभयो र कसैले त्यो बेहोर्नुपर्छ। बारम्बार यस्तै भयो भने त्यो खर्च तपाईंको अर्को बुकिङमा थपिन्छ, एक पटकमा बिलको एक चौथाइ — अरू कुनै तरिकाले माग्दैनौँ, र फेरि बुक नगर्नुभए मिनाहा हुन्छ।",
          },
          {
            p: "प्राविधिकले रद्द गर्नुभयो वा आउनुभएन भने तपाईंले केही तिर्नु पर्दैन, र हामी अर्को व्यक्ति खोजिदिन्छौं।",
          },
        ],
      },
      {
        id: "guarantee",
        heading: "ग्यारेन्टी, र यसको खर्च कसले बेहोर्छ",
        blocks: [
          {
            p: "त्यो सेवाका लागि तोकिएको अवधिभित्र उही समस्या फेरि देखियो भने हामी फेरि मान्छे पठाउँछौँ, र तपाईंले केही तिर्नु पर्दैन। वाचा यत्ति हो — काम फेरि मिलाइदिने, कामका लागि लेखिएको रकमसम्म।",
          },
          {
            dl: [
              {
                term: "मर्मत — धारा, बिजुली, उपकरण, एसी, सिकर्मी काम, ट्याङ्की सफाइ",
                detail: "३० दिन। एक महिना टिकेको मर्मत टिक्यो भन्ने बुझिन्छ।",
              },
              {
                term: "रङरोगन",
                detail:
                  "९० दिन। रङ उप्किने वा फुल्ने कुरा हप्तौँपछि मात्र देखिन्छ, त्यसैले छोटो अवधिको अर्थै हुँदैनथ्यो।",
              },
              {
                term: "किरा नियन्त्रण",
                detail:
                  "३० दिन। यो काम एक पटकको भ्रमण होइन, चरणबद्ध उपचार हो — त्यसैले दोस्रो पटक आउनु प्रायः उपचार आफैँ हो, काम बिग्रेको होइन।",
              },
              {
                term: "घर सफाइ",
                detail:
                  "४८ घण्टा, र हामी फेरि सफा गरिदिन्छौँ। यसभन्दा लामो अवधि दिनु घर फेरि फोहोर हुँदैन भनेजस्तै हुन्थ्यो।",
              },
              {
                term: "सामान सार्ने र प्याकिङ",
                detail:
                  "बाटोमा भएको क्षति ४८ घण्टाभित्र जनाउनुपर्छ। त्यस्तो क्षति सामान खोल्दा थाहा हुन्छ, र त्यसपछि गाडीमै भएको हो भनी कसैले भन्न सक्दैन।",
              },
            ],
          },
          {
            p: "हरेक उजुरीमा हामी प्राविधिक पठाउँछौँ, र उहाँले जे भेट्नुहुन्छ त्यसैले भ्रमणको खर्च कसले बेहोर्ने भन्ने तय हुन्छ। मान्छे पठाउनुअघि नै तपाईंले यो कुरा मञ्जुर गर्नुहुन्छ, त्यसैले नसोचेको बिल कहिल्यै आउँदैन:",
          },
          {
            ul: [
              "उही समस्या भेटियो भने: तपाईंले केही तिर्नु पर्दैन। खर्च पहिलेको काम गर्ने प्राविधिकले बेहोर्नुहुन्छ, तपाईंले होइन।",
              "अर्कै समस्या भेटियो भने: यो सामान्य बुकिङ बन्छ र सामान्य मूल्य लाग्छ — काम सुरु गर्नुअघि तपाईंले मूल्य देख्नुहुन्छ।",
              "केही बिग्रेको भेटिएन भने: उही — सामान्य भ्रमण, सामान्य मूल्य।",
              "हामी गएपछि पुगेको क्षति भए: उही।",
            ],
          },
          {
            p: "यसो गर्नुको कारण सोझो छ — यी तीन कुरा छुट्याउने इमानदार तरिका भनेकै गएर हेर्नु हो। धारा मिलाएको दुई हप्तापछि नाली बन्द हुनु पुरानै समस्या फर्केको होइन, नयाँ काम हो, र कुन हो भन्न सक्ने भनेको भान्सामा उभिएको मान्छे नै हो।",
          },
          {
            p: "एउटै बुकिङमा बढीमा दुई पटक उजुरी गर्न सकिन्छ, एक पटकमा एउटा, र काम सकिएर भुक्तानी भइसकेको हुनुपर्छ। त्यसपछि फारम होइन, मान्छेसँगै फोनमा कुरा हुन्छ।",
          },
        ],
      },
      {
        id: "guarantee-limits",
        heading: "ग्यारेन्टीले के-के समेट्दैन",
        blocks: [
          {
            ul: [
              "मिलाइएकोभन्दा फरक समस्या। त्यो नयाँ काम हो, र सुरु गर्नुअघि हामी मूल्य भन्छौँ।",
              "समस्या आफैँ होइन, समस्याले पुर्‍याएको क्षति — चुहावटको पानी, बिजुली नआउँदा बिग्रेको खाना। हामी काम मिलाइदिन्छौँ; त्यसले बिगारेको कुरा समेट्दैनौँ। यस पृष्ठको सबैभन्दा महत्त्वपूर्ण हरफ यही हो, र पछि थाहा पाउनुभन्दा अहिले नै पढ्नुभएको राम्रो।",
              "तपाईं, अरू कसैले, वा काम सकिएपछिको दैनिक प्रयोगले पुर्‍याएको क्षति।",
              "तपाईं आफैँले ल्याउनुभएका पार्ट्स, र घोटिँदै जाने सामान — फिल्टर, वासर, बल्ब।",
              "सल्लाह दिइएको तर तपाईंले नगराउनुभएको काम। पाइप नै फेर्नुपर्छ भनिएको ठाउँमा टाल्ने मात्र गर्न भन्नुभयो भने, त्यो टालो फुट्नु काम बिग्रेको होइन।",
              "त्यसपछि अरू कसैले काम गरिसकेको कुरा।",
            ],
          },
        ],
      },
      {
        id: "how-refunds-arrive",
        heading: "फिर्ता रकम कसरी आइपुग्छ",
        blocks: [
          {
            p: "पहिले, फिर्ता कसरी तय हुन्छ: मान्छेले निर्णय गर्छ, र त्यो पनि कोही गएर समस्या हाम्रै हो र मिलाउन सकिँदैन भनी पुष्टि भएपछि मात्र। एपले आफैँ कुनै फिर्ता निकाल्दैन। रकम कामका लागि लेखिएको अङ्कभन्दा बढी हुँदैन — नगदमा तिरेपछि तपाईंले लेख्ने अङ्क त्यसैले महत्त्वपूर्ण हुन्छ।",
          },
          {
            dl: [
              {
                term: "इसेवा वा खल्तीबाट तिर्नुभएको भए",
                detail:
                  "त्यही वालेटमै फिर्ता हुन्छ। हामी २ कार्यदिनभित्र सुरु गर्छौं; वालेटमा प्रायः ५ दिनभित्र देखिन्छ।",
              },
              {
                term: "नगदमा तिर्नुभएको भए",
                detail:
                  "तपाईंको इसेवा वा खल्ती खातामा पठाउँछौं, वा हाम्रो कार्यालयबाट नगदै लिन सक्नुहुन्छ। तपाईंकै रोजाइ — हामी अनुमान गर्दैनौँ, सोध्छौं।",
              },
            ],
          },
        ],
      },
      {
        id: "not-refundable",
        heading: "के फिर्ता गर्न सकिँदैन",
        blocks: [
          {
            ul: [
              "तपाईंकै भनाइमा किनेर जडान भइसकेका पार्ट्स, जब पार्ट्स आफैँमा बिग्रिएको छैन।",
              "तपाईंले नयाँ मूल्य मञ्जुर गरेर सहमतिअनुसार भइसकेको काम, जसमा पछि मन फेरिएको हो।",
              "पहिल्यैदेखि रहेको क्षति, जुन मर्मत गर्दा देखिन आएको मात्र हो।",
              "सजिलो कामबाहिर निजी रूपमा मिलाइएको काम।",
            ],
          },
          {
            p: "आफ्नो अवस्थामा यीमध्ये कुनैसँग असहमत हुनुहुन्छ भने भन्नुहोस्। यी सामान्य आधार हुन्, छेकबार होइनन्।",
          },
        ],
      },
      {
        id: "how-to-ask",
        heading: "कसरी माग्ने",
        blocks: [
          {
            p: "बुकिङ खोलेर समस्या जनाउनुहोस्, वा सम्पर्क पृष्ठको नम्बरमा फोन गर्नुहोस्। के तय भएको थियो, के भयो, र तपाईं के चाहनुहुन्छ — भन्नुहोस्। हामी एक कार्यदिनभित्र जवाफ दिने लक्ष्य राख्छौं।",
          },
          {
            p: "यहाँ लेखिएको कुनै कुराले नेपाली उपभोक्ता कानुनअन्तर्गतका तपाईंका अधिकार घटाउँदैन।",
          },
        ],
      },
    ],
  },
};
