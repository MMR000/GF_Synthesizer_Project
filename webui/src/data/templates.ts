export interface TemplateDef {
  title: string;
  language: "Kazakh" | "Russian" | "English";
  mood: string;
  description: string;
  text: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    title: "Kazakh neutral baseline",
    language: "Kazakh",
    mood: "Neutral",
    description: "Plain neutral sentence for a baseline timbre reference.",
    text: "Бүгін біз жергілікті TTS моделін тексеріп жатырмыз. Бұл қарапайым бейтарап сөйлем.",
  },
  {
    title: "Kazakh enthusiasm",
    language: "Kazakh",
    mood: "Enthusiasm",
    description: "Energetic, expressive launch announcement.",
    text: "<|emotion:enthusiasm|><|prosody:expressive_high|>Бүгін біз жергілікті TTS моделін сәтті іске қостық! <|prosody:pause|> Бұл өте қызықты нәтиже.",
  },
  {
    title: "Kazakh laughter",
    language: "Kazakh",
    mood: "Amusement",
    description: "Playful line with inline laughter SFX.",
    text: "<|emotion:amusement|><|prosody:expressive_high|>Бейба ағам керемет <|sfx:laughter|>Haha, одан артық не керек?",
  },
  {
    title: "Kazakh whisper",
    language: "Kazakh",
    mood: "Whispering",
    description: "Soft whispered internal test line.",
    text: "<|style:whispering|><|emotion:contemplation|>Бұл тек ішкі тест. <|prosody:pause|> Дауыстың шынымен сыбырлап шыққанын тексерейік.",
  },
  {
    title: "Kazakh sadness",
    language: "Kazakh",
    mood: "Sadness",
    description: "Slow, low, melancholic delivery.",
    text: "<|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Мен бұл нәтиже басқаша болады деп ойлаған едім. <|prosody:long_pause|> Бірақ біз әлі де жалғастырамыз.",
  },
  {
    title: "Kazakh anger",
    language: "Kazakh",
    mood: "Anger",
    description: "Firm, high-energy demand.",
    text: "<|emotion:anger|><|prosody:expressive_high|><|prosody:pitch_high|>Бұл қате қайта-қайта қайталанбауы керек! <|prosody:pause|> Біз оны бүгін түзетуіміз қажет.",
  },
  {
    title: "Russian enthusiasm",
    language: "Russian",
    mood: "Enthusiasm",
    description: "Excited Russian launch line.",
    text: "<|emotion:enthusiasm|><|prosody:expressive_high|>Сегодня мы наконец запустили локальную модель синтеза речи! <|prosody:pause|> Это очень интересный результат.",
  },
  {
    title: "English laughter",
    language: "English",
    mood: "Amusement",
    description: "Casual English line with laughter.",
    text: "<|emotion:amusement|><|prosody:expressive_high|>Wait, that was actually hilarious. <|sfx:laughter|>Hehe, I really did not expect that.",
  },
  {
    title: "Long Kazakh positive laughter",
    language: "Kazakh",
    mood: "Amusement",
    description: "Long single-pass upbeat passage with repeated delivery tags.",
    text: "<|emotion:amusement|><|prosody:expressive_high|><|prosody:pitch_high|>Бибо ағам сондай сүйкімді! Оны көрген адамның басы айналып, бағытын таба алмай қалады! <|sfx:laughter|>Haha, шынымен айтамын, Бибо ағам бір күлімдесе болды, бүкіл бөлме жарқ етіп кетеді! <|prosody:pause|><|emotion:amusement|><|prosody:expressive_high|>Ол кірсе — бәрі күледі, ол сөйлесе — бәрі тыңдайды, ол күлсе — бітті, ешкім өзін ұстай алмайды! <|sfx:laughter|>Hehe, Бибо ағам жүрсе мереке, отырса концерт, үндемей тұрса да дайын комедия сияқты!\n\n<|prosody:pause|><|emotion:enthusiasm|><|prosody:expressive_high|>Бибо ағам керемет адам! Одан артық не керек өзі? Біреу шаршап отырса, Бибо ағам бір ауыз сөз айтады да, бәрі қайта тіріліп кеткендей болады! <|sfx:laughter|>Haha haha, ол кәдімгі көңіл-күй генераторы ғой! Оның жанында уайым да ұзақ тұрмайды, шаршау да қашып кетеді, жаман ой болса өзі есіктен шығып кетеді! <|prosody:pause|><|emotion:amusement|>Бибо ағам бір қарап қойса болды, адам өзінің проблемасын ұмытып, “мен неге мұңайып отырмын?” деп өзі күліп жібереді!\n\n<|prosody:pause|><|emotion:amusement|><|prosody:expressive_high|>Мен кейде шын ойлаймын: егер сүйкімділікке медаль берілсе, Бибо ағам алтын медальді ғана емес, бүкіл жарысты алып кетер еді! Егер күлкіге конкурс болса, ол дайындалмай-ақ бірінші орын алар еді! Егер жақсы көңіл-күй сатылатын болса, Бибо ағамның бір күлкісі ең қымбат бренд болар еді! <|sfx:laughter|>Hehe, Бибо ағам сондай керемет, оны мақтауға сөз жетпейді! Ерекше, сүйкімді, көңілді, жылы жүзді, қызық, күлкілі — бәрі бір адамның ішінде! <|sfx:laughter|>Haha, Бибо ағам бар жерде көңілсіз отыру мүмкін емес! Одан артық не керек?",
  },
  {
    title: "Multi-emotion Kazakh drama",
    language: "Kazakh",
    mood: "Multi-emotion",
    description: "Emotional arc: contentment, surprise, sadness, anger, relief, amusement.",
    text: "<|emotion:contentment|><|prosody:expressive_high|>Бибо ағам мені мақтағанда, менің жүрегім бірден жылып кетеді. Ол “жарайсың” десе болды, мен өзімді әлемдегі ең ақылды, ең мықты, ең бақытты адам сияқты сезінемін. <|emotion:elation|>Сол сәтте қуанышым ішіме сыймай, аспанға ұшып кеткім келеді. <|sfx:laughter|>Haha, Бибо ағамның бір мақтауы маған бір аптаға жететін энергия береді.\n\n<|prosody:pause|><|emotion:surprise|>Бірақ кейде Бибо ағам күтпеген жерден қатты сөйлеп қояды. Мен бірден абдырап қаламын. <|emotion:confusion|>Басымда мың сұрақ пайда болады, ал жауап біреу де жоқ сияқты. <|prosody:pause|> Ол маған ұрысқанда, көңілім қатты жарақаттанады. <|emotion:sadness|><|prosody:speed_slow|><|prosody:pitch_low|>Сол кезде ішімнен бір нәрсе үзіліп кеткендей болады.\n\n<|prosody:long_pause|><|emotion:anger|><|prosody:expressive_high|>Ал егер біреу Бибо ағам туралы жаман сөз айтса, мен бірден ашуланамын! Жоқ, оған болмайды! Бибо ағамды ешкім ренжітпеуі керек! <|prosody:pause|><|emotion:relief|>Бірақ Бибо ағам қайтадан күлімдеп, “ештеңе етпейді” десе, менің жаным бірден тынышталады. <|emotion:amusement|><|prosody:expressive_high|>Сосын ол бір күлкілі нәрсе айтып қояды да, мен бәрін ұмытып кетемін. <|sfx:laughter|>Haha, міне, Бибо ағамның күші осында.",
  },
];
