/**
 * Neutral participant instructions: they do not name sections or say what is
 * being assessed, so answers are not steered.
 */
export function recommendedInstructions(unlockDays = 10) {
  return {
    en: `1. Questions are shown one at a time. Read each question carefully.
2. Choose the one best answer. Where a question describes a situation, choose what you would actually do.
3. Your answers are saved automatically. You can flag a question and come back to it before submitting.
4. Use the EN / HI switch at the top right to change the language at any time.
5. Please stay on this page until you submit. Leaving the exam tab is recorded.
6. Your result will be available ${unlockDays} days after you submit.`,
    hi: `1. प्रश्न एक-एक करके दिखाए जाते हैं। हर प्रश्न ध्यान से पढ़ें।
2. सबसे उपयुक्त एक उत्तर चुनें। जहाँ प्रश्न में कोई परिस्थिति दी गई हो, वही चुनें जो आप वास्तव में करेंगे।
3. आपके उत्तर अपने-आप सहेजे जाते हैं। आप किसी प्रश्न को चिह्नित करके जमा करने से पहले उस पर लौट सकते हैं।
4. भाषा बदलने के लिए ऊपर दाईं ओर EN / HI बटन का उपयोग करें।
5. जमा करने तक कृपया इसी पेज पर रहें। परीक्षा टैब छोड़ना दर्ज किया जाता है।
6. आपका परिणाम जमा करने के ${unlockDays} दिन बाद उपलब्ध होगा।`,
  };
}
