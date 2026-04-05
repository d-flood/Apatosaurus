# Installing Webfonts
Follow these simple Steps.

## 1.
Put `lora/` Folder into a Folder called `fonts/`.

## 2.
Put `lora.css` into your `css/` Folder.

## 3. (Optional)
You may adapt the `url('path')` in `lora.css` depends on your Website Filesystem.

## 4.
Import `lora.css` at the top of you main Stylesheet.

```
@import url('lora.css');
```

## 5.
You are now ready to use the following Rules in your CSS to specify each Font Style:
```
font-family: Lora-Regular;
font-family: Lora-Italic;
font-family: Lora-Medium;
font-family: Lora-MediumItalic;
font-family: Lora-SemiBold;
font-family: Lora-SemiBoldItalic;
font-family: Lora-Bold;
font-family: Lora-BoldItalic;
font-family: Lora-Variable;
font-family: Lora-VariableItalic;

```
## 6. (Optional)
Use `font-variation-settings` rule to controll axes of variable fonts:
wght 400.0

Available axes:
'wght' (range from 400.0 to 700.0

