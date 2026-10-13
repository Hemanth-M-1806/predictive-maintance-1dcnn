#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

#define SDA_PIN 21
#define SCL_PIN 22

#define IN3 27
#define IN4 26
#define ENB 14

void setup()
{
  Serial.begin(115200);
  delay(1000);

  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);

  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  digitalWrite(ENB, HIGH);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  if (!mpu.begin())
  {
    Serial.println("MPU6050 NOT FOUND");
    while (1)
    {
      delay(1000);
    }
  }

  Serial.println("MPU6050 FOUND");

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);

  delay(1000);
}

void loop()
{
  sensors_event_t acceleration;
  sensors_event_t gyro;
  sensors_event_t temperature;

  mpu.getEvent(
    &acceleration,
    &gyro,
    &temperature
  );

  Serial.print(acceleration.acceleration.x, 6);
  Serial.print(",");

  Serial.print(acceleration.acceleration.y, 6);
  Serial.print(",");

  Serial.println(acceleration.acceleration.z, 6);

  delay(20);
}