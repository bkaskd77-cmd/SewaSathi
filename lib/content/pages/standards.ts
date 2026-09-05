import type { LocalisedDocument } from "@/lib/content/types";

/**
 * The enforcement ladder, written for the people it applies to.
 *
 * DETERRENCE ONLY WORKS IF IT IS VISIBLE. A scoring system nobody can read is
 * not a deterrent — it is a trap, and the first a professional hears of it is
 * the day their work dries up for reasons nobody will explain. That produces
 * exactly the wrong result: the honest ones leave because the platform feels
 * arbitrary, and the dishonest ones simply learn the thresholds by
 * experiment.
 *
 * So every step is named, every step says what triggered it, and every step
 * has a person and an appeal. The page is linked from /providers/join, before
 * anybody signs up, because agreeing to rules you were shown is a different
 * thing from discovering them afterwards.
 *
 * WHAT IS DELIBERATELY NOT HERE: exact thresholds. "Three jobs in thirty days"
 * would be a specification for staying just under it. The signals are named in
 * full and the consequences are named in full; the numbers are ours.
 */

export const standards: LocalisedDocument = {
  en: {
    title: "Our standards, and what happens if they are broken",
    lead:
      "How SajiloKaam handles under-reported jobs and money taken off the platform — what we count, what we never count, and exactly what each step costs.",
    updated: "2026-09-05",
    sections: [
      {
        id: "why",
        heading: "Why this page exists",
        blocks: [
          {
            p: "A professional who does good work and records it honestly should never be worse off than one who does not. That is the whole of it. Every rule below exists to make the honest choice the profitable one, and none of it is worth anything if you cannot read it before you sign up.",
          },
          {
            p: "We would rather explain the rules than catch people. Nothing on this page is a secret, and nothing on it happens without a person looking first, from the third step onward.",
          },
        ],
      },
      {
        id: "the-fee-minimum",
        heading: "Why the fee has a minimum",
        blocks: [
          {
            p: "Our commission is 15%, and it is charged on the job's final amount or on the published minimum for that service, whichever is higher. If a plumbing job's published band starts at Rs 900 and you record Rs 400, the fee is still calculated on Rs 900.",
          },
          {
            p: "This is not a penalty and it does not assume anything about you. It exists so that recording a smaller number than you were paid gains nobody anything — which means nobody has any reason to ask you to.",
          },
          {
            p: "Jobs genuinely do come in under the band: the tap only needed a washer. Say so on the job and a person reviews it, usually the same day. If the whole category keeps landing under its minimum, that is our price being wrong, not yours — we move the band and nobody is penalised for it.",
          },
        ],
      },
      {
        id: "what-we-look-at",
        heading: "What we actually look at",
        blocks: [
          {
            p: "All of it is compared against other professionals doing the same category of work, not against a fixed number. A category where every job is cash is not a suspicious category.",
          },
          {
            ul: [
              "Final amounts that cluster at or just below the published minimum, far more often than your peers.",
              "Jobs cancelled after you have met the customer, again far more often than your peers.",
              "Customers who confirm an amount different from the one you recorded.",
              "Customers who book you once, then keep using SajiloKaam for other work and never book through it again.",
              "Jobs marked finished that never settle at all.",
            ],
          },
        ],
      },
      {
        id: "never-a-signal",
        heading: "What is never a signal",
        blocks: [
          {
            p: "These are named because a system that punished them would be punishing good work, and because you should be able to do all of them without wondering:",
          },
          {
            ul: [
              "Charging less than the band. A cheap, fast job is a good job.",
              "Taking cash. It is the primary way Nepal pays and it always will be here.",
              "Turning work down. You are allowed to be busy.",
              "A customer complaint on its own. Complaints are read, not counted.",
              "Working few jobs, or being new.",
            ],
          },
        ],
      },
      {
        id: "the-ladder",
        heading: "The five steps",
        blocks: [
          {
            p: "Nothing here triggers on one job. Each step names what it costs and how it is lifted.",
          },
          {
            dl: [
              {
                term: "1. You are told, privately",
                detail:
                  "The numbers we are seeing, on your own dashboard, next to your category's average. No penalty, nothing a customer can see, no record kept if it stops. Most of this ends here.",
              },
              {
                term: "2. List position",
                detail:
                  "You appear lower in search while the pattern continues, and recover as it stops. Automatic, reversible, and never permanent. Nothing is removed and nothing is public.",
              },
              {
                term: "3. Digital settlement, and no open jobs",
                detail:
                  "New jobs settle by eSewa or Khalti only, and you stop being offered jobs from the open pool — customers who ask for you by name still reach you. A person decides this, not a score, and it is lifted after a conversation and a run of clean jobs.",
              },
              {
                term: "4. Payouts held, listing hidden",
                detail:
                  "Your listing stops appearing while the review runs, and money already earned waits rather than being paid out. It is not taken. If the review clears you, it is released in full with an apology.",
              },
              {
                term: "5. Removed, and the fee reclaimed",
                detail:
                  "For confirmed, deliberate under-reporting: the listing is removed permanently and the commission that was avoided is charged. Where a customer was overcharged, they are refunded first, before we recover anything.",
              },
            ],
          },
        ],
      },
      {
        id: "appeal",
        heading: "Your appeal, at every step",
        blocks: [
          {
            p: "At every step you can see what triggered it, in numbers, and ask a person to look again. An appeal is answered by a human being, not by the same system that raised it.",
          },
          {
            p: "Steps 3, 4 and 5 are never automatic. A person reviews the evidence and can undo any of them.",
          },
        ],
      },
      {
        id: "payouts",
        heading: "Why digital reaches you sooner",
        blocks: [
          {
            p: "A digital payment is confirmed by eSewa or Khalti themselves, so we can pay it out quickly. Cash has to be reconciled against a confirmation the customer types, so it waits longer. That difference is an operational fact, not a punishment — and it is the reason we would rather grow digital payments than inspect cash for ever.",
          },
        ],
      },
    ],
  },

  ne: {
    title: "हाम्रा मापदण्ड, र उल्लङ्घन भए के हुन्छ",
    lead:
      "कम रकम लेखिएका काम र प्लेटफर्म बाहिर गएको पैसालाई सजिलोकामले कसरी हेर्छ — के गनिन्छ, के कहिल्यै गनिँदैन, र हरेक चरणले के खर्च गराउँछ।",
    updated: "2026-09-05",
    sections: [
      {
        id: "why",
        heading: "यो पृष्ठ किन",
        blocks: [
          {
            p: "राम्रो काम गर्ने र इमानदारीसाथ रकम लेख्ने प्राविधिकले नलेख्नेभन्दा कहिल्यै घाटा बेहोर्नु हुँदैन। कुरा यत्ति हो। तलका हरेक नियम इमानदार बाटोलाई नै फाइदाजनक बनाउन बनेका हुन्, र दर्ता गर्नुअघि तपाईंले पढ्न नपाउने हो भने यीमध्ये कुनैको अर्थ छैन।",
          },
          {
            p: "मान्छे पक्रनुभन्दा नियम बुझाउन हामीलाई मन पर्छ। यस पृष्ठमा लुकाइएको केही छैन, र तेस्रो चरणदेखि माथिको कुनै पनि कुरा मान्छेले नहेरी हुँदैन।",
          },
        ],
      },
      {
        id: "the-fee-minimum",
        heading: "शुल्कमा न्यूनतम किन",
        blocks: [
          {
            p: "हाम्रो कमिसन १५% हो, र यो कामको अन्तिम रकम वा त्यो सेवाको प्रकाशित न्यूनतम — जुन बढी हुन्छ, त्यसैमा लाग्छ। धाराको प्रकाशित दायरा रु ९०० बाट सुरु हुन्छ भने तपाईंले रु ४०० लेख्नुभयो भने पनि शुल्क रु ९०० मै गणना हुन्छ।",
          },
          {
            p: "यो सजाय होइन, र यसले तपाईंबारे कुनै अनुमान गर्दैन। पाएको भन्दा कम रकम लेख्दा कसैलाई केही फाइदा नहोस् भन्नका लागि हो — अर्थात् तपाईंलाई त्यसो गर्न भन्नुपर्ने कारण नै कसैसँग रहँदैन।",
          },
          {
            p: "कहिलेकाहीँ काम साँच्चै दायराभन्दा सानो हुन्छ — धारालाई वासर मात्र चाहिएको थियो। त्यही कुरा कामकै पानामा लेख्नुहोस्, मान्छेले हेर्छ, प्रायः त्यही दिन। पूरै सेवाका काम बारम्बार न्यूनतमभन्दा तल आइरहेछन् भने त्यो हाम्रो मूल्य गलत भएको हो, तपाईंको होइन — हामी दायरा नै मिलाउँछौँ, र त्यसका लागि कसैलाई कारबाही हुँदैन।",
          },
        ],
      },
      {
        id: "what-we-look-at",
        heading: "हामी के हेर्छौँ",
        blocks: [
          {
            p: "यी सबै कुरा तोकिएको अङ्कसँग होइन, उही सेवा गर्ने अरू प्राविधिकसँग तुलना गरेर हेरिन्छ। सबै काम नगदमा हुने सेवा आफैँमा शङ्कास्पद होइन।",
          },
          {
            ul: [
              "अन्तिम रकम बारम्बार प्रकाशित न्यूनतममै वा त्यसभन्दा अलिकति तल आउनु — साथीभाइभन्दा धेरै पटक।",
              "ग्राहकलाई भेटिसकेपछि काम रद्द हुनु — यो पनि अरूभन्दा धेरै पटक।",
              "ग्राहकले लेखेको रकम र तपाईंले लेखेको रकम फरक पर्नु।",
              "ग्राहकले तपाईंलाई एक पटक बुक गरेपछि अरू कामका लागि सजिलोकाम चलाइरहने तर तपाईंलाई फेरि कहिल्यै बुक नगर्नु।",
              "सकियो भनिएको तर भुक्तानी नै नभएका काम।",
            ],
          },
        ],
      },
      {
        id: "never-a-signal",
        heading: "के कहिल्यै सङ्केत होइन",
        blocks: [
          {
            p: "यी कुरा किन लेखिएका छन् भने यिनलाई कारबाहीको आधार बनाउनु भनेको राम्रो कामलाई सजाय दिनु हो, र यी गर्दा तपाईंले मनमा शङ्का राख्नु नपरोस्:",
          },
          {
            ul: [
              "दायराभन्दा कम शुल्क लिनु। छिटो र सस्तोमा सकिएको काम राम्रो काम हो।",
              "नगद लिनु। नेपालमा भुक्तानीको मुख्य तरिका यही हो, र यहाँ सधैँ रहन्छ।",
              "काम अस्वीकार गर्नु। व्यस्त हुन पाइन्छ।",
              "एउटा गुनासो आउनु। गुनासो पढिन्छ, गनिँदैन।",
              "काम थोरै हुनु, वा नयाँ हुनु।",
            ],
          },
        ],
      },
      {
        id: "the-ladder",
        heading: "पाँच चरण",
        blocks: [
          {
            p: "एउटा कामले यीमध्ये कुनै पनि चरण सुरु गर्दैन। हरेक चरणले के खर्च गराउँछ र कसरी हट्छ, दुवै तल लेखिएको छ।",
          },
          {
            dl: [
              {
                term: "१. तपाईंलाई निजी रूपमा जानकारी",
                detail:
                  "हामीले देखेका अङ्कहरू तपाईंकै ड्यासबोर्डमा, सेवाको औसतको छेउमा। कुनै कारबाही हुँदैन, ग्राहकले केही देख्दैनन्, र रोकियो भने कुनै रेकर्ड पनि रहँदैन। धेरैजसो कुरा यहीँ सकिन्छ।",
              },
              {
                term: "२. सूचीमा स्थान",
                detail:
                  "क्रम जारी रहेसम्म खोजमा तल देखिनुहुन्छ, रोकिएपछि बिस्तारै उही ठाउँमा फर्किनुहुन्छ। स्वतः हुन्छ, फर्किन्छ, र कहिल्यै स्थायी हुँदैन। केही हटाइँदैन, केही सार्वजनिक हुँदैन।",
              },
              {
                term: "३. डिजिटल भुक्तानी मात्र, र खुला काम बन्द",
                detail:
                  "नयाँ काम इसेवा वा खल्तीबाट मात्र मिल्छ, र खुला सूचीबाट काम आउन बन्द हुन्छ — नाम तोकेर खोज्ने ग्राहक भने तपाईंकहाँ आइरहन्छन्। यो अङ्कले होइन, मान्छेले निर्णय गर्छ, र कुराकानी तथा केही सफा कामपछि हट्छ।",
              },
              {
                term: "४. भुक्तानी रोक्का, सूची लुकाइने",
                detail:
                  "अनुसन्धान चल्दासम्म तपाईंको सूची देखिँदैन, र कमाइसकेको पैसा दिइनुको साटो पर्खिन्छ। खोसिँदैन। अनुसन्धानले सफा ठहर्‍यायो भने पूरै रकम माफीसहित दिइन्छ।",
              },
              {
                term: "५. हटाइने, र शुल्क असुलिने",
                detail:
                  "जानाजान कम रकम लेखेको पुष्टि भएमा: सूची स्थायी रूपमा हट्छ र छलिएको कमिसन असुल गरिन्छ। ग्राहकबाट बढी लिइएको रहेछ भने पहिले उहाँलाई फिर्ता हुन्छ, त्यसपछि मात्र हामी केही असुल्छौँ।",
              },
            ],
          },
        ],
      },
      {
        id: "appeal",
        heading: "हरेक चरणमा तपाईंको भनाइ",
        blocks: [
          {
            p: "हरेक चरणमा त्यो किन सुरु भयो भन्ने अङ्कसहित हेर्न पाउनुहुन्छ, र मान्छेलाई फेरि हेर्न भन्न पाउनुहुन्छ। जवाफ मान्छेले दिन्छ — जुन प्रणालीले उठायो, त्यसैले होइन।",
          },
          {
            p: "तेस्रो, चौथो र पाँचौँ चरण कहिल्यै स्वतः हुँदैनन्। मान्छेले प्रमाण हेर्छ र जुनसुकै चरण फिर्ता लिन सक्छ।",
          },
        ],
      },
      {
        id: "payouts",
        heading: "डिजिटल भुक्तानी किन छिटो पुग्छ",
        blocks: [
          {
            p: "डिजिटल भुक्तानी इसेवा वा खल्तीले आफैँ पुष्टि गर्छन्, त्यसैले हामी छिटो पठाउन सक्छौँ। नगदचाहिँ ग्राहकले लेखेको पुष्टिसँग मिलाउनुपर्ने हुनाले ढिलो हुन्छ। यो फरक कामको प्रकृतिले आएको हो, सजाय होइन — र यही कारणले नगदलाई सधैँ जाँचिरहनुभन्दा डिजिटल भुक्तानी बढाउन हामी रुचाउँछौँ।",
          },
        ],
      },
    ],
  },
};
